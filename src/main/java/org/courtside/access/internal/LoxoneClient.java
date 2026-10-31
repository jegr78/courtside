package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.net.ssl.SSLContext;
import java.net.ConnectException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** The Miniserver's web services over HTTPS: address, token, the request lock and one deadline per call. */
final class LoxoneClient implements AutoCloseable {

    static final int USER_MANAGEMENT = 0x800;
    static final String LOCKED = "Miniserver lock after requests without rights";

    private static final int APP_AND_USER_MANAGEMENT = 0x4 | USER_MANAGEMENT;
    private static final Duration RENEWAL_MARGIN = Duration.ofHours(1);
    private static final Duration LOCK = Duration.ofMinutes(5);
    private static final Duration MOST_MARGIN = Duration.ofMillis(250);
    private static final int MOST_REPLY_BYTES = 4 * 1024 * 1024;
    private static final String SPS = "/jdev/sps/";
    private static final String SYS = "/jdev/sys/";
    private static final Set<Integer> HEADER_ANSWERS = Set.of(401, 403, 423, 429);

    /** {@code enveloped} is false for an answer that carried no Miniserver reply, only an HTTP status. */
    record Reply(int code, @Nullable JsonNode value, boolean enveloped) {
    }

    /** The Miniserver refused the whole connector; a non-null {@code notBefore} is its lock. */
    static final class Refusal extends RuntimeException {

        private final @Nullable Instant notBefore;

        Refusal(String reason, @Nullable Instant notBefore) {
            super(ConnectorText.sanitized(reason, null), null, false, false);
            this.notBefore = notBefore;
        }

        String reason() {
            return getMessage();
        }

        @Nullable Instant notBefore() {
            return notBefore;
        }
    }

    static final class Unreachable extends LoxoneFailure {

        Unreachable(String message) {
            super(message);
        }
    }

    /** Sees each request, without the token and the user, and each answer as it arrived. */
    interface Tap {

        void request(String command, List<String> arguments, Map<String, String> query);

        void response(String command, int status, byte[] body);
    }

    private static final class Disconnected extends LoxoneFailure {

        Disconnected(String command) {
            super("could not connect for " + command);
        }
    }

    private final LoxoneSettings settings;
    private final Clock clock;
    private final HttpClient http;
    private final ObjectMapper json = new ObjectMapper();
    private final String clientUuid;
    private volatile @Nullable URI base;
    private volatile @Nullable String token;
    private volatile Instant renewAt = Instant.MIN;
    private volatile @Nullable Instant lockedUntil;
    private volatile boolean closed;
    private volatile @Nullable Tap tap;

    LoxoneClient(LoxoneSettings settings, SSLContext ssl, Clock clock) {
        this.settings = settings;
        this.clock = clock;
        this.clientUuid = LoxoneLogin.clientUuid(settings.address());
        this.http = HttpClient.newBuilder()
                .sslContext(ssl)
                .connectTimeout(settings.callDeadline())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    /** The call deadline less a margin, so the connector ends a call before the call runner abandons it. */
    static Duration budget(Duration callDeadline) {
        Duration tenth = callDeadline.dividedBy(10);
        return callDeadline.minus(tenth.compareTo(MOST_MARGIN) < 0 ? tenth : MOST_MARGIN);
    }

    Session session() {
        if (closed) {
            throw new LoxoneFailure("the connector is closed");
        }
        return new Session(System.nanoTime() + budget(settings.callDeadline()).toNanos());
    }

    /** One port call: every request it sends shares the call's deadline. */
    final class Session {

        private final long deadline;

        private Session(long deadline) {
            this.deadline = deadline;
        }

        void authenticate() {
            token(this);
        }

        Reply sps(String command, String... arguments) {
            String current = token(this);
            Reply reply = send(this, SPS, command, List.of(arguments), current);
            if (reply.code() == 401) {
                drop(current);
                reply = send(this, SPS, command, List.of(arguments), token(this));
                if (reply.code() == 401) {
                    throw new Refusal("Miniserver refused the token for " + command + " (401)", null);
                }
            }
            return refused(command, reply);
        }

        /** A request that changes the Miniserver; only a code from its own reply counts as an answer. */
        Reply changing(String command, String... arguments) {
            Reply reply = sps(command, arguments);
            if (!reply.enveloped()) {
                throw new LoxoneFailure(command + " answered without a Miniserver reply (" + reply.code() + ")");
            }
            return reply;
        }

        private Duration remaining(String command) {
            if (Thread.currentThread().isInterrupted()) {
                throw new LoxoneFailure("interrupted before " + command);
            }
            long left = deadline - System.nanoTime();
            if (left <= 0) {
                throw new LoxoneFailure("no answer to " + command + " within the call deadline");
            }
            return Duration.ofNanos(left);
        }
    }

    private String token(Session session) {
        String current = token;
        if (current != null && clock.instant().isBefore(renewAt)) {
            return current;
        }
        token = null;
        String user = settings.user();
        Reply key = login("getkey2", send(session, SYS, "getkey2", List.of(user), null));
        String hash = LoxoneLogin.hash(user, settings.password(), text(key, "key", "getkey2"),
                text(key, "salt", "getkey2"), text(key, "hashAlg", "getkey2"));
        Reply jwt = login("getjwt", send(session, SYS, "getjwt",
                List.of(hash, user, String.valueOf(APP_AND_USER_MANAGEMENT), clientUuid, "Courtside"), null));
        String issued = text(jwt, "token", "getjwt");
        JsonNode value = jwt.value();
        if (value == null || !value.path("validUntil").isNumber() || !value.path("tokenRights").isNumber()) {
            throw new LoxoneFailure("getjwt answered without a lifespan or rights");
        }
        if ((value.path("tokenRights").asLong() & USER_MANAGEMENT) == 0) {
            kill(session, issued);
            throw new Refusal("token lacks the user-management right", null);
        }
        renewAt = LoxoneTime.instant(value.path("validUntil").asLong(), settings.zone().zoneId()).minus(RENEWAL_MARGIN);
        token = issued;
        return issued;
    }

    private Reply login(String command, Reply reply) {
        return switch (reply.code()) {
            case 200 -> reply;
            case 401 -> throw new Refusal("Miniserver refused the login of the technical user (" + command + " 401)",
                    null);
            case 400 -> throw new LoxoneFailure(command + " answered 400: the Miniserver may require command "
                    + "encryption");
            default -> {
                refused(command, reply);
                throw new LoxoneFailure(command + " answered " + reply.code());
            }
        };
    }

    private Reply refused(String command, Reply reply) {
        return switch (reply.code()) {
            case 403 -> throw new Refusal("Miniserver denied " + command + " (403)", null);
            case 423 -> throw new Refusal("Miniserver disabled the technical user (" + command + " 423)", null);
            case 429 -> {
                Instant until = clock.instant().plus(LOCK);
                lockedUntil = until;
                throw new Refusal(LOCKED, until);
            }
            default -> reply;
        };
    }

    private void drop(String spent) {
        if (spent.equals(token)) {
            token = null;
        }
    }

    private void kill(Session session, String spent) {
        try {
            send(session, SYS, "killtoken", List.of(spent, settings.user()), null);
        } catch (RuntimeException bestEffort) {
            // An unkilled token only expires on its own; the refusal that follows is the answer.
        }
    }

    private Reply send(Session session, String prefix, String command, List<String> arguments,
                       @Nullable String authentication) {
        Instant locked = lockedUntil;
        if (locked != null && clock.instant().isBefore(locked)) {
            throw new Refusal(LOCKED, locked);
        }
        URI origin = base(session);
        Tap observer = tap;
        if (observer != null) {
            observer.request(command, arguments, Map.of());
        }
        Reply reply;
        try {
            reply = reply(transmit(session, command, target(origin, prefix, command, arguments, authentication)));
        } catch (LoxoneFailure failed) {
            forgetRelay();
            throw failed;
        }
        if (!reply.enveloped() && !HEADER_ANSWERS.contains(reply.code())) {
            forgetRelay();
        }
        return reply;
    }

    private void forgetRelay() {
        if (settings.address() instanceof LoxoneAddress.Serial) {
            base = null;
        }
    }

    private URI base(Session session) {
        URI known = base;
        if (known != null) {
            return known;
        }
        URI resolved = switch (settings.address()) {
            case LoxoneAddress.Fixed(URI url) -> origin(url, "the configured address");
            case LoxoneAddress.Serial serial -> resolve(session, serial);
        };
        base = resolved;
        return resolved;
    }

    private URI resolve(Session session, LoxoneAddress.Serial serial) {
        URI lookup = URI.create(origin(serial.resolver(), "the resolver") + "/getip?snr=" + encoded(serial.serial()));
        Tap observer = tap;
        if (observer != null) {
            observer.request("getip", List.of(), Map.of("snr", serial.serial()));
        }
        HttpResponse<byte[]> response = transmit(session, "getip", lookup);
        int status = response.statusCode();
        if (status == 400 || status == 404 || status == 504) {
            throw new Unreachable("Loxone Cloud found no address for the Miniserver (getip " + status + ")");
        }
        if (status != 200) {
            throw new LoxoneFailure("getip answered " + status);
        }
        JsonNode url;
        try {
            url = json.readTree(response.body()).path("url");
        } catch (JacksonException unparseable) {
            throw new LoxoneFailure("getip answered no readable address");
        }
        if (!url.isString() || url.asString().isBlank()) {
            throw new LoxoneFailure("getip answered no readable address");
        }
        String address = url.asString().strip();
        URI resolved;
        try {
            resolved = new URI(address.contains("://") ? address : "https://" + address);
        } catch (URISyntaxException malformed) {
            throw new LoxoneFailure("getip answered no readable address");
        }
        if (!serial.admits(resolved)) {
            throw new LoxoneFailure("getip answered an address outside Loxone's relays");
        }
        return origin(resolved, "getip");
    }

    private static URI origin(URI url, String source) {
        String scheme = url.getScheme();
        String authority = url.getRawAuthority();
        if (scheme == null || !scheme.toLowerCase(Locale.ROOT).equals("https") || authority == null
                || url.getHost() == null || authority.contains("@")) {
            throw new LoxoneFailure(source + " names no https address");
        }
        return URI.create("https://" + authority);
    }

    private URI target(URI origin, String prefix, String command, List<String> arguments,
                       @Nullable String authentication) {
        StringBuilder path = new StringBuilder(origin.toString()).append(prefix).append(command);
        arguments.forEach(argument -> path.append('/').append(encoded(argument)));
        if (authentication != null) {
            path.append("?autht=").append(encoded(authentication)).append("&user=").append(encoded(settings.user()));
        }
        return URI.create(path.toString());
    }

    private HttpResponse<byte[]> transmit(Session session, String command, URI target) {
        Duration remaining = session.remaining(command);
        HttpRequest request = HttpRequest.newBuilder(target)
                .timeout(remaining)
                .GET()
                .build();
        CompletableFuture<HttpResponse<byte[]>> exchange = http.sendAsync(request,
                HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(), MOST_REPLY_BYTES));
        try {
            HttpResponse<byte[]> response = exchange.get(remaining.toNanos(), TimeUnit.NANOSECONDS);
            Tap observer = tap;
            if (observer != null) {
                observer.response(command, response.statusCode(), response.body());
            }
            return response;
        } catch (TimeoutException late) {
            exchange.cancel(true);
            throw new LoxoneFailure("no answer to " + command + " within the call deadline");
        } catch (InterruptedException interrupted) {
            exchange.cancel(true);
            Thread.currentThread().interrupt();
            throw new LoxoneFailure("interrupted during " + command);
        } catch (ExecutionException failed) {
            Throwable cause = failed.getCause();
            if (cause instanceof HttpTimeoutException) {
                throw new LoxoneFailure("no answer to " + command + " within the call deadline");
            }
            if (refusedConnection(cause)) {
                throw new Disconnected(command);
            }
            String kind = cause == null ? "unknown" : cause.getClass().getSimpleName();
            throw new LoxoneFailure(command + " failed: " + kind);
        }
    }

    private static boolean refusedConnection(@Nullable Throwable cause) {
        for (Throwable step = cause; step != null; step = step.getCause()) {
            if (step instanceof ConnectException) {
                return true;
            }
        }
        return false;
    }

    private Reply reply(HttpResponse<byte[]> response) {
        JsonNode envelope;
        try {
            envelope = json.readTree(response.body()).path("LL");
        } catch (JacksonException unparseable) {
            return new Reply(response.statusCode(), null, false);
        }
        if (!envelope.isObject()) {
            return new Reply(response.statusCode(), null, false);
        }
        JsonNode value = envelope.get("value");
        if (value != null && value.isString()) {
            String text = value.asString().strip();
            if (text.startsWith("{") || text.startsWith("[")) {
                try {
                    value = json.readTree(text);
                } catch (JacksonException notJson) {
                    value = envelope.get("value");
                }
            }
        }
        return new Reply(code(envelope).orElse(response.statusCode()), value, true);
    }

    private static OptionalInt code(JsonNode envelope) {
        JsonNode code = envelope.properties().stream().filter(field -> field.getKey().equalsIgnoreCase("Code"))
                .map(Map.Entry::getValue).findFirst().orElse(null);
        if (code == null) {
            return OptionalInt.empty();
        }
        if (code.isNumber()) {
            return OptionalInt.of(code.asInt());
        }
        if (code.isString() && code.asString().strip().matches("[0-9]{3}")) {
            return OptionalInt.of(Integer.parseInt(code.asString().strip()));
        }
        return OptionalInt.empty();
    }

    private static String text(Reply reply, String field, String command) {
        JsonNode value = reply.value();
        if (value == null || !value.path(field).isString() || value.path(field).asString().isBlank()) {
            throw new LoxoneFailure(command + " answered without " + field);
        }
        return value.path(field).asString();
    }

    static String encoded(String segment) {
        StringBuilder encoded = new StringBuilder();
        for (byte octet : segment.getBytes(StandardCharsets.UTF_8)) {
            int unsigned = octet & 0xff;
            if (unsigned < 0x80 && (Character.isLetterOrDigit(unsigned) || "-._~".indexOf(unsigned) >= 0)) {
                encoded.append((char) unsigned);
            } else {
                encoded.append('%').append(Character.toUpperCase(Character.forDigit(unsigned >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(unsigned & 0xf, 16)));
            }
        }
        return encoded.toString();
    }

    void tap(@Nullable Tap observer) {
        tap = observer;
    }

    boolean closed() {
        return closed;
    }

    @Override
    public void close() {
        String current = token;
        token = null;
        if (current != null && base != null) {
            try {
                send(session(), SYS, "killtoken", List.of(current, settings.user()), null);
            } catch (RuntimeException bestEffort) {
                // Shutdown proceeds; the token expires on the Miniserver by itself.
            }
        }
        closed = true;
        http.shutdownNow();
    }
}
