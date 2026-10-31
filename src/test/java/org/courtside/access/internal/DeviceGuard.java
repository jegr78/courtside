package org.courtside.access.internal;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/** Stops a device run before any request that could touch a group or a user the run does not own. */
final class DeviceGuard implements LoxoneClient.Tap {

    static final Pattern OWN = Pattern.compile("courtside_device_[0-9a-f]{16}");

    private static final Set<String> ALLOWED = Set.of("getkey2", "getjwt", "killtoken", "getuserlist2", "getgrouplist",
            "getuser", "addoredituser", "deleteuser", "updateuseraccesscode", "getip", "apiKey", "date", "time");
    private static final Set<String> NAMING_A_USER = Set.of("deleteuser", "updateuseraccesscode");
    private static final ObjectMapper JSON = new ObjectMapper();

    private record Listed(String name, boolean admin) {
    }

    private final LoxoneClient.Tap next;
    private final Consumer<String> owned;
    private final Set<String> issued = ConcurrentHashMap.newKeySet();
    private final Map<String, Listed> users = new ConcurrentHashMap<>();

    DeviceGuard(LoxoneClient.Tap next, Consumer<String> owned) {
        this.next = next;
        this.owned = owned;
    }

    void issue(String name) {
        if (!OWN.matcher(name).matches()) {
            throw new AssertionError("a device run issues only names of its own pattern");
        }
        issued.add(name);
        owned.accept(name);
    }

    boolean issued(String name) {
        return issued.contains(name);
    }

    @Override
    public void request(String command, List<String> arguments, Map<String, String> query) {
        if (!ALLOWED.contains(command)) {
            throw new AssertionError("a device run never sends " + command);
        }
        if (command.equals("addoredituser")) {
            guardEdit(arguments);
        }
        if (NAMING_A_USER.contains(command)) {
            Listed user = arguments.isEmpty() ? null : users.get(arguments.getFirst());
            if (user == null || user.admin() || !ours(user.name())) {
                throw new AssertionError(command + " names a user this run does not own");
            }
        }
        next.request(command, arguments, query);
    }

    @Override
    public void response(String command, int status, byte[] body) {
        value(body).ifPresent(value -> {
            if (command.equals("getuserlist2") && value.isArray()) {
                value.forEach(this::remember);
            } else if (command.equals("addoredituser") && value.isObject()) {
                remember(value);
            }
        });
        next.response(command, status, body);
    }

    private void guardEdit(List<String> arguments) {
        JsonNode user = arguments.size() == 1 ? RecordedFixtures.embedded(arguments.getFirst()).orElse(null) : null;
        if (user == null || !user.isObject()) {
            throw new AssertionError("addoredituser carries no user");
        }
        String name = user.path("name").asString("");
        if (LoxoneConnectionChecks.PROBE_USER.matcher(name).matches()) {
            owned.accept(name);
        }
        if (!ours(name)) {
            throw new AssertionError("addoredituser names a user this run does not own");
        }
        if (user.has("usergroups") && !(user.get("usergroups").isArray() && user.get("usergroups").isEmpty())) {
            throw new AssertionError("addoredituser would assign a group");
        }
        if (user.has("uuid")) {
            Listed edited = users.get(user.path("uuid").asString(""));
            if (edited == null || edited.admin() || !ours(edited.name())) {
                throw new AssertionError("addoredituser edits a user this run does not own");
            }
        }
    }

    private boolean ours(String name) {
        return issued.contains(name) || LoxoneConnectionChecks.PROBE_USER.matcher(name).matches();
    }

    private void remember(JsonNode user) {
        users.put(user.path("uuid").asString(""),
                new Listed(user.path("name").asString(""), user.path("isAdmin").asBoolean(true)));
    }

    private static Optional<JsonNode> value(byte[] body) {
        JsonNode value;
        try {
            value = JSON.readTree(new String(body, StandardCharsets.UTF_8)).path("LL").path("value");
        } catch (RuntimeException unreadable) {
            return Optional.empty();
        }
        return value.isString() ? RecordedFixtures.embedded(value.asString()) : Optional.of(value);
    }
}
