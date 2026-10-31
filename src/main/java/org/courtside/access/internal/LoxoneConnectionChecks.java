package org.courtside.access.internal;

import org.courtside.access.CheckResult;
import org.courtside.access.ConnectionCheck;
import org.courtside.access.RemoteGroup;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/** The Miniserver's connection checks; the probe user's name stays outside the pattern of a grant's user. */
final class LoxoneConnectionChecks {

    static final Pattern PROBE_USER = Pattern.compile("courtside_probe_[0-9a-f]{16}");

    private static final List<String> LOGIN = List.of("login");
    private static final Duration PROBE_WINDOW = Duration.ofMinutes(2);
    private static final List<String> READ_BACK = List.of("validFrom", "validUntil", "expirationAction");

    private final LoxoneAccessControl connector;
    private final LoxoneClient client;
    private final LoxoneSettings settings;
    private final LoxoneGroupMapping mapping;
    private final Clock clock;
    private final ObjectMapper json = new ObjectMapper();

    LoxoneConnectionChecks(LoxoneAccessControl connector, LoxoneClient client, LoxoneSettings settings,
                           LoxoneGroupMapping mapping, Clock clock) {
        this.connector = connector;
        this.client = client;
        this.settings = settings;
        this.mapping = mapping;
        this.clock = clock;
    }

    List<ConnectionCheck> all(Map<UUID, String> granted) {
        return List.of(
                new ConnectionCheck("miniserver", List.of(), guarded(this::miniserver)),
                new ConnectionCheck("login", List.of(), guarded(this::login)),
                new ConnectionCheck("groups", LOGIN, guarded(() -> groups(granted))),
                new ConnectionCheck("clock", List.of(), () -> CheckResult.skipped("access.check.clock.notSettled",
                        Map.of())),
                new ConnectionCheck("probe-user", LOGIN, guarded(this::probeUser)),
                new ConnectionCheck("keypad", List.of(), () -> CheckResult.manual("access.check.keypad.manual")));
    }

    private static Supplier<CheckResult> guarded(Supplier<CheckResult> check) {
        return () -> {
            try {
                return check.get();
            } catch (LoxoneClient.Untrusted untrusted) {
                return CheckResult.failed("access.check.certificateRefused", Map.of());
            } catch (LoxoneClient.Late late) {
                return CheckResult.failed("access.check.timeout", Map.of());
            } catch (LoxoneClient.Refusal refusal) {
                return CheckResult.failed("access.check.refused", Map.of("reason", refusal.reason()));
            } catch (LoxoneFailure failure) {
                return CheckResult.failed("access.check.unclear", Map.of("reason", failure.getMessage()));
            }
        };
    }

    private CheckResult miniserver() {
        LoxoneClient.Session session = client.session();
        client.forgetAddress();
        LoxoneClient.Reply answered;
        try {
            answered = session.configuration("apiKey");
        } catch (LoxoneClient.Unresolved unresolved) {
            return CheckResult.failed("access.check.address.unresolved",
                    Map.of("status", String.valueOf(unresolved.status())));
        } catch (LoxoneClient.OutsideRelays outside) {
            return CheckResult.failed("access.check.address.outsideRelays", Map.of());
        }
        if (!answered.enveloped()) {
            return CheckResult.failed("access.check.address.noMiniserver",
                    Map.of("status", String.valueOf(answered.code())));
        }
        Optional<LoxoneVersion> found = answered.code() == 200 ? LoxoneVersion.of(answered.value()) : Optional.empty();
        if (found.isEmpty()) {
            return CheckResult.failed("access.check.version.unreadable", Map.of());
        }
        Map<String, String> parameters = Map.of("version", found.get().toString(),
                "minimum", LoxoneVersion.MINIMUM.toString());
        return found.get().atLeast(LoxoneVersion.MINIMUM)
                ? CheckResult.passed("access.check.miniserver.reached", parameters)
                : CheckResult.failed("access.check.version.tooOld", parameters);
    }

    private CheckResult login() {
        try {
            client.session().login();
        } catch (LoxoneClient.Refusal refusal) {
            return switch (refusal.kind()) {
                case CREDENTIALS -> CheckResult.failed("access.check.login.refused", Map.of());
                case RIGHT -> CheckResult.failed("access.check.login.missingRight", Map.of());
                case LOCKED -> CheckResult.failed("access.check.login.locked", Map.of());
                default -> throw refusal;
            };
        }
        return CheckResult.passed("access.check.login.accepted", Map.of());
    }

    private CheckResult groups(Map<UUID, String> granted) {
        Set<String> normal = new HashSet<>();
        connector.readGroups(client.session()).stream().map(RemoteGroup::id).forEach(normal::add);
        if (granted.isEmpty()) {
            return CheckResult.passed("access.check.groups.noneNeeded", Map.of());
        }
        List<String> unmapped = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        granted.entrySet().stream().sorted(Map.Entry.comparingByValue()).forEach(accessPoint -> {
            Optional<String> group = mapping.groupOf(accessPoint.getKey())
                    .filter(uuid -> LoxoneAccessControl.LOXONE_UUID.matcher(uuid).matches());
            if (group.isEmpty()) {
                unmapped.add(accessPoint.getValue());
            } else if (!normal.contains(group.get())) {
                missing.add(accessPoint.getValue());
            }
        });
        if (!unmapped.isEmpty()) {
            return CheckResult.failed("access.check.groups.unmapped", Map.of("accessPoints", String.join(", ", unmapped)));
        }
        if (!missing.isEmpty()) {
            return CheckResult.failed("access.check.groups.missing", Map.of("accessPoints", String.join(", ", missing)));
        }
        List<String> names = granted.values().stream().sorted().toList();
        return CheckResult.passed("access.check.groups.mapped", Map.of("accessPoints", String.join(", ", names)));
    }

    private CheckResult probeUser() {
        LoxoneClient.Session session = client.session();
        for (JsonNode listed : LoxoneAccessControl.listing(session)) {
            if (PROBE_USER.matcher(listed.path("name").asString("")).matches()) {
                String uuid = listed.path("uuid").asString("");
                if (listed.path("isAdmin").asBoolean(true) || !LoxoneAccessControl.LOXONE_UUID.matcher(uuid).matches()) {
                    return CheckResult.failed("access.check.probeUser.leftoverProtected", Map.of());
                }
                LoxoneAccessControl.delete(session, uuid);
            }
        }
        ZoneId zone = settings.zone().zoneId();
        Instant now = clock.instant();
        Map<String, Long> window = Map.of("validFrom", LoxoneTime.from(now, zone),
                "validUntil", LoxoneTime.until(now.plus(PROBE_WINDOW), zone), "expirationAction", 1L);
        LoxoneClient.Reply created = session.changing("addoredituser", probe(window));
        String uuid = created.value() == null ? "" : created.value().path("uuid").asString("");
        if (created.code() != 200 || !LoxoneAccessControl.LOXONE_UUID.matcher(uuid).matches()) {
            return CheckResult.failed("access.check.probeUser.notCreated",
                    Map.of("status", String.valueOf(created.code())));
        }
        String mismatch = readBack(session, uuid, window);
        int deleted = session.changing("deleteuser", uuid).code();
        if (mismatch != null) {
            return CheckResult.failed("access.check.probeUser.readBack", Map.of("field", mismatch));
        }
        if (deleted != 200) {
            return CheckResult.failed("access.check.probeUser.notDeleted", Map.of("status", String.valueOf(deleted)));
        }
        for (JsonNode listed : LoxoneAccessControl.listing(session)) {
            if (PROBE_USER.matcher(listed.path("name").asString("")).matches()) {
                return CheckResult.failed("access.check.probeUser.stillListed", Map.of());
            }
        }
        return CheckResult.passed("access.check.probeUser.passed", Map.of());
    }

    private String probe(Map<String, Long> window) {
        ObjectNode user = json.createObjectNode();
        user.put("name", "courtside_probe_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        user.put("userState", 4);
        READ_BACK.forEach(field -> user.put(field, window.get(field)));
        user.put("changePassword", false);
        user.putArray("usergroups");
        return user.toString();
    }

    private static @Nullable String readBack(LoxoneClient.Session session, String uuid, Map<String, Long> window) {
        LoxoneClient.Reply read = session.sps("getuser", uuid);
        JsonNode user = read.value();
        if (read.code() != 200 || user == null || !user.isObject()) {
            return "user";
        }
        return READ_BACK.stream().filter(field -> !user.path(field).isNumber()
                || user.path(field).asLong() != window.get(field)).findFirst().orElse(null);
    }
}
