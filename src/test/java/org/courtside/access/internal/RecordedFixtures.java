package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.core.json.JsonReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** What a recorded Miniserver exchange may still hold: placeholders, protocol words and a few known values. */
final class RecordedFixtures {

    static final Path RECORDED = Path.of("src/test/resources/loxone/recorded");
    static final Pattern PLACEHOLDER = Pattern.compile("<[a-z][a-z0-9-]*-[0-9]+>");
    private static final Pattern NUMBERED = Pattern.compile("<([a-z][a-z0-9-]*)-[0-9]+>");
    static final Set<String> VOCABULARY = Set.of("https", "http", "jdev", "dev", "sps", "sys", "cfg", "getkey2",
            "getjwt", "killtoken", "getuserlist2", "getgrouplist", "addoredituser", "deleteuser",
            "updateuseraccesscode", "getuser", "getip", "apiKey", "date", "time", "Courtside");
    static final Set<String> KEYS = Set.of("request", "command", "arguments", "query", "status", "response", "LL",
            "control", "value", "Code", "code", "key", "salt", "hashAlg", "token", "validUntil", "tokenRights",
            "unsecurePass", "uuid", "name", "description", "userState", "isAdmin", "changePassword",
            "expirationAction", "validFrom", "lastEdit", "usergroups", "keycodes", "type", "userRights", "url",
            "version", "snr", "isInTrust", "local", "httpsStatus", "date", "time", "error", "desc", "userid",
            "masterAdmin", "scorePWD", "scoreVisuPWD", "trustMember", "expiration", "nfcTags", "id", "customFields",
            "customField1", "customField2", "customField3", "customField4", "customField5", "firstName", "lastName",
            "firstname", "lastname", "email", "phone", "uniqueUserId", "company", "department", "personalno",
            "title", "debitor", "disabledBySource", "certTLD");
    static final Set<String> FREE_TEXT = Set.of("key", "desc", "description", "userid", "trustMember", "id",
            "customFields", "customField1", "customField2", "customField3", "customField4", "customField5",
            "firstName", "lastName", "firstname", "lastname", "email", "phone", "uniqueUserId", "company",
            "department", "personalno", "title", "debitor", "certTLD");
    static final Set<String> TIME_KEYS = Set.of("validFrom", "validUntil", "lastEdit", "date", "time");
    private static final Set<String> VALUE_NUMBERS = Set.of("tokenRights", "userState", "isAdmin",
            "expirationAction", "type", "userRights", "httpsStatus");
    private static final Set<String> VALUE_PARENTS = Set.of("value", "arguments");

    private static final String REDACTED = "<redacted>";
    private static final Pattern WORD = Pattern.compile("[A-Za-z0-9]+");
    private static final Pattern SEPARATORS = Pattern.compile("[A-Za-z0-9/:._ -]*");
    private static final Pattern HEX12 = Pattern.compile("[0-9A-Fa-f]{12}");
    private static final Map<String, Pattern> KEPT = Map.of(
            "hashAlg", Pattern.compile("SHA1|SHA256"),
            "version", Pattern.compile("[0-9]{1,3}(\\.[0-9]{1,5}){1,3}"),
            "command", Pattern.compile(String.join("|", VOCABULARY)));
    private static final Pattern STATUS = Pattern.compile("[0-9]{3}");
    private static final Pattern BOOLEAN = Pattern.compile("true|false");
    private static final ObjectMapper STRICT = new ObjectMapper();
    private static final ObjectMapper LENIENT = JsonMapper.builder().enable(JsonReadFeature.ALLOW_SINGLE_QUOTES)
            .build();

    private RecordedFixtures() {
    }

    /** Whether a string under {@code key}, in an object under {@code parentKey}, is a known value kept as is. */
    static boolean kept(@Nullable String parentKey, @Nullable String key, String value) {
        if (BOOLEAN.matcher(value).matches()) {
            return true;
        }
        if ("LL".equals(parentKey) && ("Code".equals(key) || "code".equals(key))) {
            return STATUS.matcher(value).matches();
        }
        Pattern allowed = key == null ? null : KEPT.get(key);
        return allowed != null && allowed.matcher(value).matches();
    }

    static Optional<JsonNode> embedded(String text) {
        String stripped = text.strip();
        if (!stripped.startsWith("{") && !stripped.startsWith("[")) {
            return Optional.empty();
        }
        for (ObjectMapper reader : List.of(STRICT, LENIENT)) {
            try {
                return Optional.of(reader.readTree(stripped));
            } catch (JacksonException notJson) {
                // The next reader may accept it.
            }
        }
        return Optional.empty();
    }

    static boolean strict(String text) {
        try {
            STRICT.readTree(text.strip());
            return true;
        } catch (JacksonException notJson) {
            return false;
        }
    }

    /** Where a replay answers differently from a recording, named by step and key path and never by value. */
    static List<String> differences(Path recorded, Path replayed) {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.list(recorded)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".json")).sorted().toList()) {
                String step = file.getFileName().toString().replaceFirst("\\.json$", "");
                Path other = replayed.resolve(file.getFileName());
                if (!Files.exists(other)) {
                    found.add(step + " was not replayed");
                    continue;
                }
                JsonNode expected = STRICT.readTree(file.toFile());
                JsonNode actual = STRICT.readTree(other.toFile());
                if (expected.size() != actual.size()) {
                    found.add(step + " has " + actual.size() + " exchanges instead of " + expected.size());
                    continue;
                }
                JsonNode wanted = renumbered(canonical(expected, null));
                JsonNode got = renumbered(canonical(actual, null));
                for (int index = 0; index < expected.size(); index++) {
                    String where = step + " $[" + index + "]";
                    compare(where, wanted.get(index), got.get(index), found);
                }
            }
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
        return found;
    }

    private static JsonNode canonical(JsonNode node, @Nullable String key) {
        if (node.isObject()) {
            ObjectNode sorted = STRICT.createObjectNode();
            node.propertyNames().stream().sorted().forEach(name -> {
                if (PLACEHOLDER.matcher(name).matches()) {
                    return;
                }
                JsonNode value = node.get(name);
                if ("request".equals(name)) {
                    sorted.set(name, STRICT.createObjectNode().set("command", value.path("command")));
                } else if ("control".equals(name) && value.isString()) {
                    sorted.put(name, upToCommand(value.asString()));
                } else {
                    sorted.set(name, canonical(value, name));
                }
            });
            return sorted;
        }
        if (node.isArray()) {
            ArrayNode copy = STRICT.createArrayNode();
            node.forEach(entry -> copy.add(canonical(entry, key)));
            return copy;
        }
        if (node.isString()) {
            Optional<JsonNode> inner = embedded(node.asString());
            if (inner.isPresent()) {
                ObjectNode wrapped = STRICT.createObjectNode();
                wrapped.set(strict(node.asString()) ? "(json)" : "(single-quoted)", canonical(inner.get(), key));
                return wrapped;
            }
        }
        return node;
    }

    private static String upToCommand(String control) {
        List<String> kept = new ArrayList<>();
        for (String segment : control.split("/", -1)) {
            kept.add(segment);
            if (VOCABULARY.contains(segment) && !Set.of("https", "http", "jdev", "dev", "sps", "sys", "cfg")
                    .contains(segment)) {
                break;
            }
        }
        return String.join("/", kept);
    }

    private static JsonNode renumbered(JsonNode node) {
        Map<String, String> seen = new HashMap<>();
        Map<String, Integer> counters = new HashMap<>();
        return renumbered(node, seen, counters);
    }

    private static JsonNode renumbered(JsonNode node, Map<String, String> seen, Map<String, Integer> counters) {
        if (node.isObject()) {
            ObjectNode copy = STRICT.createObjectNode();
            node.properties().forEach(field -> copy.set(field.getKey(), renumbered(field.getValue(), seen, counters)));
            return copy;
        }
        if (node.isArray()) {
            ArrayNode copy = STRICT.createArrayNode();
            node.forEach(entry -> copy.add(renumbered(entry, seen, counters)));
            return copy;
        }
        if (!node.isString()) {
            return node;
        }
        Matcher placeholders = NUMBERED.matcher(node.asString());
        return STRICT.getNodeFactory().stringNode(placeholders.replaceAll(found -> {
            String kind = found.group(1);
            if (kind.equals("time")) {
                return "<time>";
            }
            return seen.computeIfAbsent(found.group(),
                    any -> "<" + kind + "-" + counters.merge(kind, 1, Integer::sum) + ">");
        }));
    }

    private static void compare(String path, @Nullable JsonNode expected, @Nullable JsonNode actual,
                                List<String> found) {
        if (expected == null || actual == null) {
            found.add(path + (expected == null ? " is not in the recording" : " is missing from the replay"));
            return;
        }
        if (expected.isObject() && actual.isObject()) {
            Set<String> names = new TreeSet<>(expected.propertyNames());
            names.addAll(actual.propertyNames());
            names.forEach(name -> compare(path + "." + name, expected.get(name), actual.get(name), found));
        } else if (expected.isArray() && actual.isArray() && expected.size() == actual.size()) {
            for (int index = 0; index < expected.size(); index++) {
                compare(path + "[" + index + "]", expected.get(index), actual.get(index), found);
            }
        } else if (!expected.equals(actual)) {
            found.add(path + " differs");
        }
    }

    /** Every place under {@code directory} that holds a value no placeholder replaced; none when it is absent. */
    static List<String> violations(Path directory) {
        if (!Files.isDirectory(directory)) {
            return List.of();
        }
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(directory)) {
            for (Path file : files.filter(Files::isRegularFile).sorted().toList()) {
                String where = directory.relativize(file).toString();
                Optional<JsonNode> tree = read(file);
                if (where.endsWith(".json") && tree.isPresent()) {
                    walk(where.substring(0, where.length() - ".json".length()), "$", null, null, tree.get(), found);
                } else {
                    found.add(where + " is not a recorded JSON exchange");
                }
            }
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
        return found;
    }

    /** Every place under {@code directory} where a secret survives, in any case and the serial also as a MAC. */
    static List<String> secretViolations(Path directory, List<String> secrets) {
        List<String> spellings = spellings(secrets);
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(directory)) {
            for (Path file : files.filter(Files::isRegularFile).sorted().toList()) {
                String where = directory.relativize(file).toString().replaceFirst("\\.json$", "");
                Optional<JsonNode> tree = read(file);
                if (tree.isPresent()) {
                    secrets(where, "$", tree.get(), spellings, found);
                } else if (carries(Files.readString(file), spellings)) {
                    found.add(where + " carries a configured secret");
                }
            }
        } catch (IOException unreadable) {
            throw new UncheckedIOException(unreadable);
        }
        return found;
    }

    private static Optional<JsonNode> read(Path file) {
        try {
            return Optional.of(STRICT.readTree(file.toFile()));
        } catch (JacksonException unreadable) {
            return Optional.empty();
        }
    }

    private static void walk(String where, String path, @Nullable String parentKey, @Nullable String key,
                             JsonNode node, List<String> found) {
        if (node.isObject()) {
            node.properties().forEach(field -> {
                String name = field.getKey();
                if (allowedKey(name)) {
                    walk(where, path + "." + name, key, name, field.getValue(), found);
                } else {
                    found.add(where + " " + path + "." + REDACTED + " has a key outside the protocol keys");
                }
            });
        } else if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                walk(where, path + "[" + index + "]", parentKey, key, node.get(index), found);
            }
        } else if (node.isNumber() && !keptNumber(parentKey, key)) {
            found.add(where + " " + path + " holds a number outside the numeric keys");
        } else if (node.isString()) {
            String value = node.asString();
            Optional<JsonNode> inner = embedded(value);
            if (inner.isPresent()) {
                walk(where, path + "(json)", null, key, inner.get(), found);
            } else if (!value.isEmpty() && !kept(parentKey, key, value) && !known(value)) {
                found.add(where + " " + path + " holds a string that is neither a placeholder nor a known value");
            }
        }
    }

    /** Whether a number under {@code key}, in an object under {@code parentKey}, is a protocol number kept as is. */
    static boolean keptNumber(@Nullable String parentKey, @Nullable String key) {
        if ("Code".equals(key) || "code".equals(key)) {
            return "LL".equals(parentKey);
        }
        if ("status".equals(key)) {
            return parentKey == null;
        }
        return key != null && VALUE_NUMBERS.contains(key) && parentKey != null && VALUE_PARENTS.contains(parentKey);
    }

    static boolean allowedKey(String name) {
        return KEYS.contains(name) || PLACEHOLDER.matcher(name).matches();
    }

    private static boolean known(String value) {
        String residue = PLACEHOLDER.matcher(value).replaceAll("/");
        if (!SEPARATORS.matcher(residue).matches()) {
            return false;
        }
        Matcher words = WORD.matcher(residue);
        while (words.find()) {
            if (!VOCABULARY.contains(words.group())) {
                return false;
            }
        }
        return true;
    }

    private static void secrets(String where, String path, JsonNode node, List<String> spellings,
                                List<String> found) {
        if (node.isObject()) {
            node.properties().forEach(field -> {
                String name = field.getKey();
                if (carries(name, spellings)) {
                    found.add(where + " " + path + "." + REDACTED + " has a key that carries a configured secret");
                } else {
                    secrets(where, path + "." + (allowedKey(name) ? name : REDACTED), field.getValue(), spellings,
                            found);
                }
            });
        } else if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                secrets(where, path + "[" + index + "]", node.get(index), spellings, found);
            }
        } else if (node.isValueNode() && carries(node.isString() ? node.asString() : node.toString(), spellings)) {
            found.add(where + " " + path + " carries a configured secret");
        }
    }

    static List<String> spellings(List<String> secrets) {
        List<String> spellings = new ArrayList<>();
        for (String secret : secrets) {
            if (secret.isBlank()) {
                continue;
            }
            spellings.add(secret.toLowerCase(Locale.ROOT));
            if (HEX12.matcher(secret).matches()) {
                for (String delimiter : List.of(":", "-")) {
                    spellings.add(HexFormat.ofDelimiter(delimiter).formatHex(HexFormat.of().parseHex(secret))
                            .toLowerCase(Locale.ROOT));
                }
            }
        }
        return spellings;
    }

    static boolean carries(String text, List<String> spellings) {
        String lower = text.toLowerCase(Locale.ROOT);
        return spellings.stream().anyMatch(lower::contains);
    }
}
