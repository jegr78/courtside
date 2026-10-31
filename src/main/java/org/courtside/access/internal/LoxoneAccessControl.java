package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.RemoteGroup;
import org.courtside.access.Scope;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import javax.net.ssl.SSLContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A Loxone Miniserver holding one timespan user per grant, named {@code courtside_} plus the grant id's hex. */
class LoxoneAccessControl implements AccessControlConnector, AutoCloseable {

    static final String NAME = "loxone";

    private static final Pattern OWNED = Pattern.compile("courtside_([0-9a-f]{32})");
    private static final Pattern LOXONE_UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}");
    private static final int TIMESPAN = 4;
    private static final int DELETE_ON_EXPIRY = 1;
    private static final int NORMAL_GROUP = 0;
    private static final int MOST_MAPPING_CHARACTERS = 200;

    private final LoxoneSettings settings;
    private final LoxoneGroupMapping mapping;
    private final LoxoneClient client;
    private final ObjectMapper json = new ObjectMapper();
    private volatile List<RemoteGroup> groups = List.of();

    LoxoneAccessControl(LoxoneSettings settings, LoxoneGroupMapping mapping, SSLContext ssl, Clock clock) {
        this.settings = settings;
        this.mapping = mapping;
        this.client = new LoxoneClient(settings, ssl, clock);
    }

    @Override
    public GrantOutcome grant(GrantInstruction instruction) {
        Optional<List<String>> assigned = groupsOf(instruction.accessPointIds());
        if (assigned.isEmpty()) {
            return new GrantOutcome.Refused(Scope.GRANT, "access point has no Loxone group");
        }
        String name = nameOf(instruction.reference().grantId());
        try {
            LoxoneClient.Session session = client.session();
            List<String> listed = usersNamed(session, name);
            String kept = kept(listed, instruction.reference().externalReference());
            for (String surplus : listed) {
                if (!surplus.equals(kept)) {
                    delete(session, surplus);
                }
            }
            LoxoneClient.Reply edited = session.sps("addoredituser", user(instruction, name, kept, assigned.get()));
            switch (edited.code()) {
                case 200 -> {
                }
                case 404 -> {
                    return new GrantOutcome.Refused(Scope.GRANT, kept == null
                            ? "Loxone group not found" : "Loxone group or user not found");
                }
                case 400 -> throw failure("addoredituser answered 400: the user name is taken", instruction);
                default -> throw failure("addoredituser answered " + edited.code(), instruction);
            }
            String uuid = uuidOf(edited.value());
            if (edited.value() == null || !name.equals(edited.value().path("name").asString(""))) {
                delete(session, uuid);
                return new GrantOutcome.Refused(Scope.CONNECTOR, "Miniserver changed the user name");
            }
            return code(session, uuid, instruction);
        } catch (LoxoneClient.Refusal refusal) {
            return refused(refusal);
        }
    }

    private GrantOutcome code(LoxoneClient.Session session, String uuid, GrantInstruction instruction) {
        int answered = session.sps("updateuseraccesscode", uuid, instruction.code()).code();
        return switch (answered) {
            case 200 -> new GrantOutcome.Accepted(uuid);
            case 201 -> {
                int cleared = session.sps("updateuseraccesscode", uuid, "").code();
                if (cleared != 200) {
                    throw failure("updateuseraccesscode could not clear a code another user holds (" + cleared + ")",
                            instruction);
                }
                yield new GrantOutcome.CodeRejected();
            }
            case 409 -> new GrantOutcome.CodeRejected();
            case 400 -> new GrantOutcome.RetryLater(Scope.GRANT, null,
                    "Miniserver user vanished before its code was set");
            default -> throw failure("updateuseraccesscode answered " + answered, instruction);
        };
    }

    @Override
    public GrantOutcome revoke(GrantReference reference) {
        String name = nameOf(reference.grantId());
        try {
            LoxoneClient.Session session = client.session();
            List<String> named = usersNamed(session, name);
            for (String uuid : named) {
                delete(session, uuid);
            }
            if (!named.isEmpty() && !usersNamed(session, name).isEmpty()) {
                throw new LoxoneFailure("getuserlist2 still lists a user of this grant after deleteuser");
            }
            String external = reference.externalReference();
            return new GrantOutcome.Accepted(external == null || external.isBlank() ? name : external);
        } catch (LoxoneClient.Refusal refusal) {
            return refused(refusal);
        }
    }

    @Override
    public ProbeOutcome probe() {
        try {
            LoxoneClient.Session session = client.session();
            session.authenticate();
            listing(session);
            LoxoneClient.Reply read = session.sps("getgrouplist");
            if (read.code() != 200 || read.value() == null || !read.value().isArray()) {
                throw new LoxoneFailure("getgrouplist answered " + read.code());
            }
            List<RemoteGroup> normal = new ArrayList<>();
            for (JsonNode group : read.value()) {
                String uuid = group.path("uuid").asString("");
                if (group.path("type").asInt(-1) == NORMAL_GROUP && LOXONE_UUID.matcher(uuid).matches()) {
                    normal.add(new RemoteGroup(uuid, group.path("name").asString("")));
                }
            }
            groups = List.copyOf(normal);
            return new ProbeOutcome.Answered();
        } catch (LoxoneClient.Refusal refusal) {
            return new ProbeOutcome.Refused(refusal.reason());
        } catch (LoxoneClient.Unreachable unreachable) {
            return new ProbeOutcome.Unreachable(unreachable.getMessage());
        }
    }

    @Override
    public String mappingOf(Set<UUID> accessPointIds) {
        TreeSet<String> mapped = new TreeSet<>();
        for (UUID accessPoint : accessPointIds) {
            mapped.add(mapping.groupOf(accessPoint).orElse("unmapped"));
        }
        String joined = NAME + ":" + String.join(",", mapped);
        if (joined.length() <= MOST_MAPPING_CHARACTERS) {
            return joined;
        }
        try {
            return NAME + ":sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(joined.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 is unavailable", unavailable);
        }
    }

    @Override
    public List<RemoteGroup> groups() {
        return groups;
    }

    @Override
    public Optional<Set<UUID>> remoteGrantIds() {
        Set<UUID> ids = new HashSet<>();
        for (JsonNode user : listing(client.session())) {
            Matcher owned = OWNED.matcher(user.path("name").asString(""));
            if (!user.path("isAdmin").asBoolean(true) && owned.matches()) {
                String hex = owned.group(1);
                ids.add(UUID.fromString(hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-"
                        + hex.substring(12, 16) + "-" + hex.substring(16, 20) + "-" + hex.substring(20)));
            }
        }
        return Optional.of(Set.copyOf(ids));
    }

    @Override
    public void close() {
        client.close();
    }

    LoxoneAddress address() {
        return settings.address();
    }

    boolean closed() {
        return false;
    }

    static String nameOf(UUID grantId) {
        return "courtside_" + grantId.toString().replace("-", "");
    }

    private Optional<List<String>> groupsOf(Set<UUID> accessPointIds) {
        TreeSet<String> assigned = new TreeSet<>();
        for (UUID accessPoint : accessPointIds) {
            Optional<String> group = mapping.groupOf(accessPoint).filter(uuid -> LOXONE_UUID.matcher(uuid).matches());
            if (group.isEmpty()) {
                return Optional.empty();
            }
            assigned.add(group.get());
        }
        return Optional.of(List.copyOf(assigned));
    }

    private List<String> usersNamed(LoxoneClient.Session session, String name) {
        List<String> named = new ArrayList<>();
        for (JsonNode user : listing(session)) {
            String listedName = user.path("name").asString("");
            String uuid = user.path("uuid").asString("");
            if (!listedName.equals(name) || !OWNED.matcher(listedName).matches()) {
                continue;
            }
            if (user.path("isAdmin").asBoolean(true) || !LOXONE_UUID.matcher(uuid).matches()) {
                throw new LoxoneFailure("getuserlist2 lists a user of this grant the connector may not change");
            }
            named.add(uuid);
        }
        return named;
    }

    private JsonNode listing(LoxoneClient.Session session) {
        LoxoneClient.Reply listed = session.sps("getuserlist2");
        if (listed.code() != 200 || listed.value() == null || !listed.value().isArray()) {
            throw new LoxoneFailure("getuserlist2 answered " + listed.code());
        }
        return listed.value();
    }

    private static @Nullable String kept(List<String> listed, @Nullable String externalReference) {
        if (listed.isEmpty()) {
            return null;
        }
        return listed.contains(externalReference) ? externalReference : listed.getFirst();
    }

    private void delete(LoxoneClient.Session session, String uuid) {
        int answered = session.sps("deleteuser", uuid).code();
        if (answered != 200) {
            throw new LoxoneFailure("deleteuser answered " + answered);
        }
    }

    private String user(GrantInstruction instruction, String name, @Nullable String uuid, List<String> assigned) {
        ObjectNode user = json.createObjectNode();
        if (uuid != null) {
            user.put("uuid", uuid);
        }
        user.put("name", name);
        user.put("userState", TIMESPAN);
        user.put("validFrom", LoxoneTime.from(instruction.validFrom(), settings.zone().zoneId()));
        user.put("validUntil", LoxoneTime.until(instruction.validUntil(), settings.zone().zoneId()));
        user.put("expirationAction", DELETE_ON_EXPIRY);
        user.put("changePassword", false);
        ArrayNode usergroups = user.putArray("usergroups");
        assigned.forEach(usergroups::add);
        return user.toString();
    }

    private static String uuidOf(@Nullable JsonNode user) {
        String uuid = user == null ? "" : user.path("uuid").asString("");
        if (!LOXONE_UUID.matcher(uuid).matches()) {
            throw new LoxoneFailure("addoredituser answered without a user uuid");
        }
        return uuid;
    }

    private static LoxoneFailure failure(String message, GrantInstruction instruction) {
        return new LoxoneFailure(ConnectorText.sanitized(message, instruction.code()));
    }

    private static GrantOutcome refused(LoxoneClient.Refusal refusal) {
        return refusal.notBefore() == null
                ? new GrantOutcome.Refused(Scope.CONNECTOR, refusal.reason())
                : new GrantOutcome.RetryLater(Scope.CONNECTOR, refusal.notBefore(), refusal.reason());
    }
}
