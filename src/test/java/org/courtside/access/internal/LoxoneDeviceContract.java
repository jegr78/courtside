package org.courtside.access.internal;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** The steps of one device run; it changes only users it created in this run and never a group. */
final class LoxoneDeviceContract {

    private static final Duration WINDOW = Duration.ofMinutes(10);
    private static final ObjectMapper JSON = new ObjectMapper();

    record Observed(List<ConnectionCheckRun.Checked> checks, int code, int duplicateCode, List<String> leftOver) {
    }

    private final LoxoneAccessControl connector;
    private final LoxoneClient client;
    private final LoxoneSettings settings;
    private final Clock clock;
    private final LoxoneRecorder recorder;
    private final DeviceGuard guard;
    private final String accessCode;

    LoxoneDeviceContract(LoxoneAccessControl connector, LoxoneClient client, LoxoneSettings settings, Clock clock,
                         LoxoneRecorder recorder, DeviceGuard guard, String accessCode) {
        this.connector = connector;
        this.client = client;
        this.settings = settings;
        this.clock = clock;
        this.recorder = recorder;
        this.guard = guard;
        this.accessCode = accessCode;
    }

    Observed run() {
        Observed observed;
        try {
            observed = steps();
        } catch (RuntimeException | Error failed) {
            try {
                cleanUp();
            } catch (RuntimeException | Error uncleaned) {
                failed.addSuppressed(uncleaned);
            }
            throw failed;
        }
        cleanUp();
        return observed;
    }

    private Observed steps() {
        recorder.step("probe");
        connector.probe();
        recorder.step("connection-check");
        List<ConnectionCheckRun.Checked> checks;
        try (CallRunner calls = new CallRunner(settings.callDeadline())) {
            checks = ConnectionCheckRun.run(connector.connectionChecks(Map.of()), calls);
        }
        if (settings.address() instanceof LoxoneAddress.Serial) {
            recorder.step("getip");
            client.forgetAddress();
            client.session().configuration("apiKey");
        }
        recorder.step("api-key");
        client.session().configuration("apiKey");
        recorder.step("local-time");
        LoxoneClient.Session time = client.session();
        time.system("date");
        time.system("time");
        recorder.step("user-create");
        String first = create();
        recorder.step("user-code");
        int code = client.session().changing("updateuseraccesscode", first, accessCode).code();
        recorder.step("user-duplicate");
        String second = create();
        int duplicateCode = client.session().changing("updateuseraccesscode", second, accessCode).code();
        recorder.step("user-read");
        LoxoneClient.Reply read = client.session().sps("getuser", first);
        if (read.code() != 200) {
            throw new AssertionError("getuser answered " + read.code());
        }
        recorder.step("user-delete");
        LoxoneClient.Session deleting = client.session();
        LoxoneAccessControl.listing(deleting);
        LoxoneAccessControl.delete(deleting, first);
        LoxoneAccessControl.delete(deleting, second);
        recorder.step("user-list");
        return new Observed(checks, code, duplicateCode, ownListed());
    }

    private String create() {
        String name = "courtside_device_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        guard.issue(name);
        ZoneId zone = settings.zone().zoneId();
        Instant now = clock.instant();
        ObjectNode user = JSON.createObjectNode();
        user.put("name", name);
        user.put("userState", 4);
        user.put("validFrom", LoxoneTime.from(now, zone));
        user.put("validUntil", LoxoneTime.until(now.plus(WINDOW), zone));
        user.put("expirationAction", 1);
        user.put("changePassword", false);
        user.putArray("usergroups");
        LoxoneClient.Reply created = client.session().changing("addoredituser", user.toString());
        JsonNode value = created.value();
        String uuid = value == null ? "" : value.path("uuid").asString("");
        if (created.code() != 200 || !name.equals(value == null ? "" : value.path("name").asString(""))
                || !LoxoneAccessControl.LOXONE_UUID.matcher(uuid).matches()) {
            throw new AssertionError("addoredituser answered " + created.code() + " without the user it was asked for");
        }
        return uuid;
    }

    private List<String> ownListed() {
        List<String> left = new ArrayList<>();
        for (JsonNode user : LoxoneAccessControl.listing(client.session())) {
            if (guard.issued(user.path("name").asString(""))) {
                left.add(user.path("name").asString(""));
            }
        }
        return left;
    }

    private void cleanUp() {
        recorder.step("cleanup");
        LoxoneClient.Session session = client.session();
        for (JsonNode user : LoxoneAccessControl.listing(session)) {
            String uuid = user.path("uuid").asString("");
            if (guard.issued(user.path("name").asString("")) && !user.path("isAdmin").asBoolean(true)
                    && LoxoneAccessControl.LOXONE_UUID.matcher(uuid).matches()) {
                LoxoneAccessControl.delete(session, uuid);
            }
        }
    }
}
