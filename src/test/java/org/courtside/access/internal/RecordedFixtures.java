package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.core.json.JsonReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** What a recorded Miniserver exchange may still hold: placeholders, protocol words and a few known values. */
final class RecordedFixtures {

    static final Path RECORDED = Path.of("src/test/resources/loxone/recorded");
    static final Pattern PLACEHOLDER = Pattern.compile("<[a-z][a-z0-9-]*-[0-9]+>");
    static final Set<String> VOCABULARY = Set.of("https", "http", "jdev", "dev", "sps", "sys", "cfg", "getkey2",
            "getjwt", "killtoken", "getuserlist2", "getgrouplist", "addoredituser", "deleteuser",
            "updateuseraccesscode", "getuser", "getip", "apiKey", "date", "time", "Courtside");
    static final Set<String> TIME_KEYS = Set.of("validFrom", "validUntil", "expiration", "lastEdit", "date", "time");

    private static final Pattern KEY = Pattern.compile("[A-Za-z][A-Za-z0-9_]*");
    private static final Pattern WORD = Pattern.compile("[A-Za-z0-9]+");
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
                if (KEY.matcher(name).matches() || PLACEHOLDER.matcher(name).matches()) {
                    walk(where, path + "." + name, key, name, field.getValue(), found);
                } else {
                    found.add(where + " " + path + " has a key that is neither a placeholder nor a known name");
                }
            });
        } else if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                walk(where, path + "[" + index + "]", parentKey, key, node.get(index), found);
            }
        } else if (node.isNumber() && key != null && TIME_KEYS.contains(key)) {
            found.add(where + " " + path + " holds a time that is not a placeholder");
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

    private static boolean known(String value) {
        Matcher words = WORD.matcher(PLACEHOLDER.matcher(value).replaceAll("/"));
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
                if (carries(field.getKey(), spellings)) {
                    found.add(where + " " + path + " has a key that carries a configured secret");
                }
                secrets(where, path + "." + field.getKey(), field.getValue(), spellings, found);
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
                spellings.add(HexFormat.ofDelimiter(":").formatHex(HexFormat.of().parseHex(secret))
                        .toLowerCase(Locale.ROOT));
            }
        }
        return spellings;
    }

    static boolean carries(String text, List<String> spellings) {
        String lower = text.toLowerCase(Locale.ROOT);
        return spellings.stream().anyMatch(lower::contains);
    }
}
