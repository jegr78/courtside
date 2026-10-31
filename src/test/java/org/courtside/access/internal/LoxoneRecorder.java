package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** Records what the tap sees per step and writes it scrubbed, only once nothing but placeholders survived. */
final class LoxoneRecorder implements LoxoneClient.Tap {

    private static final Pattern STEP = Pattern.compile("[a-z0-9]+(-[a-z0-9]+)*");
    private static final Pattern REQUEST_LINE = Pattern.compile("/?j?dev/.*");
    private static final Pattern URL = Pattern.compile("(https?)://([^/:?#\\s]+)(?::([0-9]+))?(/\\S*)?");
    private static final Pattern HOST = Pattern.compile("((?:[A-Za-z0-9-]+\\.)+[A-Za-z][A-Za-z0-9-]*)(?::([0-9]+))?");
    private static final Pattern UUID =
            Pattern.compile("\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{12}");
    private static final Pattern SHORT_UUID =
            Pattern.compile("\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{12}");
    private static final Pattern LOXONE_UUID =
            Pattern.compile("\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{16}");
    private static final Pattern IP = Pattern.compile("[0-9]{1,3}(\\.[0-9]{1,3}){3}");
    private static final Pattern DASHED_IP = Pattern.compile("[0-9]{1,3}(-[0-9]{1,3}){3}");
    private static final Pattern MAC = Pattern.compile("\\p{XDigit}{2}(:\\p{XDigit}{2}){5}");
    private static final Pattern TIME =
            Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}([ T].*)?|[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?");
    private static final Pattern DIGITS = Pattern.compile("[0-9]+");
    private static final Pattern HEX = Pattern.compile("\\p{XDigit}{8,}");
    private static final Pattern JWT = Pattern.compile("eyJ\\S+");
    private static final Pattern TOKEN = Pattern.compile("(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9+/_=.-]{16,}");
    private static final Pattern UPPER = Pattern.compile(".*[A-F].*");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private static final class Exchange {

        private final String command;
        private final List<String> arguments;
        private final Map<String, String> query;
        private @Nullable Integer status;
        private byte @Nullable [] body;

        private Exchange(String command, List<String> arguments, Map<String, String> query) {
            this.command = command;
            this.arguments = List.copyOf(arguments);
            this.query = Map.copyOf(query);
        }
    }

    private final List<String> secrets;
    private final List<String> spellings;
    private final Set<String> created = ConcurrentHashMap.newKeySet();
    private final Map<String, List<Exchange>> steps = new LinkedHashMap<>();
    private final Map<String, String> placeholders = new HashMap<>();
    private final Map<String, Integer> counters = new HashMap<>();
    private String step = "setup";

    LoxoneRecorder(List<String> secrets) {
        this.secrets = List.copyOf(secrets);
        this.spellings = RecordedFixtures.spellings(secrets);
    }

    synchronized void step(String name) {
        if (!STEP.matcher(name).matches()) {
            throw new AssertionError("a step is named in lowercase words joined by hyphens");
        }
        step = name;
    }

    void created(String name) {
        created.add(name);
    }

    @Override
    public synchronized void request(String command, List<String> arguments, Map<String, String> query) {
        steps.computeIfAbsent(step, any -> new ArrayList<>()).add(new Exchange(command, arguments, query));
    }

    @Override
    public synchronized void response(String command, int status, byte[] body) {
        List<Exchange> current = steps.computeIfAbsent(step, any -> new ArrayList<>());
        Exchange open = current.reversed().stream()
                .filter(exchange -> exchange.status == null && exchange.command.equals(command))
                .findFirst().orElseGet(() -> {
                    Exchange unasked = new Exchange(command, List.of(), Map.of());
                    current.add(unasked);
                    return unasked;
                });
        open.status = status;
        open.body = body.clone();
    }

    /** Scrubs every step into a temporary directory, checks those files, then moves them to {@code recorded}. */
    synchronized void write(Path recorded) {
        Path staging;
        try {
            staging = Files.createTempDirectory("loxone-recorded");
            for (Map.Entry<String, List<Exchange>> entry : steps.entrySet()) {
                ArrayNode exchanges = NODES.arrayNode();
                entry.getValue().forEach(exchange -> exchanges.add(scrubbed(exchange)));
                Files.writeString(staging.resolve(entry.getKey() + ".json"),
                        JSON.writerWithDefaultPrettyPrinter().writeValueAsString(exchanges) + "\n");
            }
        } catch (IOException unwritable) {
            throw new UncheckedIOException(unwritable);
        }
        List<String> violations = new ArrayList<>(RecordedFixtures.secretViolations(staging, secrets));
        violations.addAll(RecordedFixtures.violations(staging));
        try {
            if (!violations.isEmpty()) {
                throw new AssertionError("the recording was not written: " + String.join("; ", violations));
            }
            Files.createDirectories(recorded);
            try (Stream<Path> files = Files.list(staging)) {
                for (Path file : files.sorted().toList()) {
                    Files.move(file, recorded.resolve(file.getFileName()), StandardCopyOption.REPLACE_EXISTING);
                }
            }
        } catch (IOException unmovable) {
            throw new UncheckedIOException(unmovable);
        } finally {
            delete(staging);
        }
    }

    private ObjectNode scrubbed(Exchange exchange) {
        ObjectNode request = NODES.objectNode();
        request.put("command", RecordedFixtures.kept(null, "command", exchange.command) ? exchange.command
                : text(exchange.command, null));
        ArrayNode arguments = request.putArray("arguments");
        exchange.arguments.forEach(argument -> arguments.add(text(argument, "arguments")));
        ObjectNode query = request.putObject("query");
        exchange.query.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(parameter -> query.put(parameter.getKey(), text(parameter.getValue(), parameter.getKey())));
        ObjectNode recorded = NODES.objectNode();
        recorded.set("request", request);
        if (exchange.status != null) {
            recorded.put("status", exchange.status);
            recorded.set("response", body(exchange.body == null ? new byte[0] : exchange.body));
        }
        return recorded;
    }

    private JsonNode body(byte[] raw) {
        String text = new String(raw, StandardCharsets.UTF_8);
        Optional<JsonNode> parsed = RecordedFixtures.embedded(text);
        if (parsed.isPresent()) {
            return node(parsed.get(), null, null);
        }
        if (text.isBlank()) {
            return NODES.stringNode("");
        }
        return NODES.stringNode(text.strip().startsWith("<") ? placeholder("html", text) : text(text, null));
    }

    private JsonNode node(JsonNode node, @Nullable String parentKey, @Nullable String key) {
        if (node.isObject()) {
            ObjectNode scrubbed = NODES.objectNode();
            node.properties().forEach(field -> {
                String name = RecordedFixtures.allowedKey(field.getKey()) ? field.getKey()
                        : placeholder(spellings.contains(field.getKey().toLowerCase(Locale.ROOT)) ? "secret" : "key",
                        field.getKey());
                scrubbed.set(name, node(field.getValue(), key, field.getKey()));
            });
            return scrubbed;
        }
        if (node.isArray()) {
            ArrayNode scrubbed = NODES.arrayNode();
            boolean named = !node.isEmpty() && node.valueStream().allMatch(entry -> entry.path("name").isString());
            node.valueStream().filter(entry -> !named || created.contains(entry.path("name").asString()))
                    .forEach(entry -> scrubbed.add(node(entry, parentKey, key)));
            return scrubbed;
        }
        if (node.isNumber() && !RecordedFixtures.keptNumber(parentKey, key)) {
            boolean time = key != null && RecordedFixtures.TIME_KEYS.contains(key);
            return NODES.stringNode(placeholder(time ? "time" : "number", node.toString()));
        }
        if (node.isString()) {
            String value = node.asString();
            return NODES.stringNode(RecordedFixtures.kept(parentKey, key, value) ? value : text(value, key));
        }
        return node;
    }

    private String text(String value, @Nullable String key) {
        if (value.isEmpty()) {
            return value;
        }
        if (spellings.contains(value.toLowerCase(Locale.ROOT))) {
            return placeholder("secret", value);
        }
        if (created.contains(value)) {
            return placeholder("name", value);
        }
        Optional<JsonNode> inner = RecordedFixtures.embedded(value);
        if (inner.isPresent()) {
            return JSON.writeValueAsString(node(inner.get(), null, key));
        }
        if ("control".equals(key) || REQUEST_LINE.matcher(value).matches()) {
            return line(value);
        }
        return formatted(value).orElse(value);
    }

    private Optional<String> formatted(String value) {
        if (JWT.matcher(value).matches()) {
            return Optional.of(placeholder("token", value));
        }
        Matcher url = URL.matcher(value);
        if (url.matches()) {
            return Optional.of(url.group(1) + "://" + placeholder("host", url.group(2))
                    + (url.group(3) == null ? "" : ":" + placeholder("port", url.group(3)))
                    + (url.group(4) == null || url.group(4).equals("/") ? "" : line(url.group(4))));
        }
        Matcher host = HOST.matcher(value);
        if (host.matches()) {
            return Optional.of(placeholder("host", host.group(1))
                    + (host.group(2) == null ? "" : ":" + placeholder("port", host.group(2))));
        }
        String upper = UPPER.matcher(value).matches() ? "-upper" : "";
        if (UUID.matcher(value).matches()) {
            return Optional.of(placeholder("uuid" + upper, value));
        }
        if (SHORT_UUID.matcher(value).matches()) {
            return Optional.of(placeholder("short-uuid" + upper, value));
        }
        if (LOXONE_UUID.matcher(value).matches()) {
            return Optional.of(placeholder("loxone-uuid" + upper, value));
        }
        if (IP.matcher(value).matches()) {
            return Optional.of(placeholder("ip", value));
        }
        if (DASHED_IP.matcher(value).matches()) {
            return Optional.of(placeholder("dashed-ip", value));
        }
        if (MAC.matcher(value).matches()) {
            return Optional.of(placeholder("mac", value));
        }
        if (TIME.matcher(value).matches()) {
            return Optional.of(placeholder("time", value));
        }
        if (DIGITS.matcher(value).matches()) {
            return Optional.of(placeholder("digits" + value.length(), value));
        }
        if (HEX.matcher(value).matches()) {
            return Optional.of(placeholder("hex" + value.length() + upper, value));
        }
        if (TOKEN.matcher(value).matches()) {
            return Optional.of(placeholder("token", value));
        }
        return Optional.empty();
    }

    private String line(String requestLine) {
        int query = requestLine.indexOf('?');
        String path = query < 0 ? requestLine : requestLine.substring(0, query);
        List<String> segments = new ArrayList<>();
        for (String raw : path.split("/", -1)) {
            String segment = URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8);
            if (segment.isEmpty() || RecordedFixtures.VOCABULARY.contains(segment)) {
                segments.add(segment);
            } else if (RecordedFixtures.embedded(segment).isPresent()) {
                segments.add(placeholder("json", segment));
            } else {
                segments.add(text(segment, null));
            }
        }
        return String.join("/", segments);
    }

    private String placeholder(String kind, String value) {
        return placeholders.computeIfAbsent(value,
                any -> "<" + kind + "-" + counters.merge(kind, 1, Integer::sum) + ">");
    }

    private static void delete(Path directory) {
        try (Stream<Path> paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        } catch (IOException unremovable) {
            throw new UncheckedIOException(unremovable);
        }
    }
}
