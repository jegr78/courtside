package org.courtside.payment.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.payment.PayPalEnvironment;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Currency;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;

@Slf4j
public class PayPalClient {

    static final int MAX_REASON = 200;
    private static final int MAX_TOKEN_BYTES = 16_384;
    private static final int MAX_API_BYTES = 65_536;
    private static final Duration TOKEN_MARGIN = Duration.ofSeconds(60);
    private static final Pattern ORDER_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern AMOUNT = Pattern.compile("\\d{1,15}(\\.\\d+)?");
    private static final String ALREADY_CAPTURED = "ORDER_ALREADY_CAPTURED";
    private static final String DUPLICATE_REQUEST = "DUPLICATE_REQUEST_ID";
    private static final String REQUEST_IN_PROGRESS = "PREVIOUS_REQUEST_IN_PROGRESS";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final PayPalProperties properties;
    private final Clock clock;
    private final HttpClient client;
    private final Map<String, CachedToken> tokens = new ConcurrentHashMap<>();

    PayPalClient(PayPalProperties properties) {
        this(properties, Clock.systemUTC());
    }

    PayPalClient(PayPalProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
        this.client = HttpClient.newBuilder().connectTimeout(properties.requestTimeout()).build();
    }

    Order createOrder(Credentials credentials, UUID bookingId, int amountMinor, Currency currency, URI returnUrl,
                      URI cancelUrl) {
        int digits = currency.getDefaultFractionDigits();
        if (digits < 0 || amountMinor <= 0) throw new IllegalStateException("The amount cannot be sent to PayPal");
        ObjectNode body = JSON.createObjectNode();
        body.put("intent", "CAPTURE");
        ObjectNode unit = body.putArray("purchase_units").addObject();
        unit.put("custom_id", bookingId.toString());
        ObjectNode amount = unit.putObject("amount");
        amount.put("currency_code", currency.getCurrencyCode());
        amount.put("value", new BigDecimal(BigInteger.valueOf(amountMinor), digits).toPlainString());
        ObjectNode context = body.putObject("payment_source").putObject("paypal").putObject("experience_context");
        context.put("return_url", returnUrl.toString());
        context.put("cancel_url", cancelUrl.toString());
        context.put("user_action", "PAY_NOW");
        context.put("shipping_preference", "NO_SHIPPING");
        Answer answer = api(credentials, "POST", "/v2/checkout/orders", JSON.writeValueAsString(body),
                bookingId.toString());
        return order(success(answer));
    }

    Order getOrder(Credentials credentials, String orderId) {
        return order(success(api(credentials, "GET", orderPath(orderId), null, null)));
    }

    Capture captureOrder(Credentials credentials, String orderId) {
        Answer answer = api(credentials, "POST", orderPath(orderId) + "/capture", "{}", orderId);
        if (answer.status() == 422 && hasIssue(answer.body(), ALREADY_CAPTURED)) {
            return captureOf(getOrder(credentials, orderId));
        }
        if (answer.status() == 409 || answer.status() / 100 == 4
                && (hasIssue(answer.body(), DUPLICATE_REQUEST) || hasIssue(answer.body(), REQUEST_IN_PROGRESS))) {
            throw new PayPalUnavailableException("PayPal is still processing an earlier capture of this order");
        }
        return capture(success(answer)).orElseThrow(() -> new PayPalRefusedException("PayPal order has no capture"));
    }

    Answer requestToken(PayPalEnvironment environment, String clientId, String secret) {
        String basic = Base64.getEncoder().encodeToString((clientId + ":" + secret).getBytes(StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder(endpoint(environment, "/v1/oauth2/token"))
                .timeout(properties.requestTimeout())
                .header("Authorization", "Basic " + basic)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials"))
                .build();
        return send(environment, request, MAX_TOKEN_BYTES);
    }

    private String token(Credentials credentials) {
        String key = credentials.cacheKey();
        Instant now = clock.instant();
        CachedToken cached = tokens.get(key);
        if (cached != null && now.isBefore(cached.validUntil())) return cached.value();
        tokens.values().removeIf(token -> !now.isBefore(token.validUntil()));
        Answer answer = requestToken(credentials.environment(), credentials.clientId(), credentials.secret());
        JsonNode body = success(answer);
        JsonNode value = body.get("access_token");
        JsonNode lifetime = body.get("expires_in");
        if (value == null || !value.isString() || value.asString().isBlank() || lifetime == null
                || !lifetime.canConvertToLong()) {
            throw new PayPalRefusedException("PayPal answered the token request without a usable token");
        }
        CachedToken fresh = new CachedToken(value.asString(),
                now.plusSeconds(lifetime.asLong()).minus(TOKEN_MARGIN));
        tokens.put(key, fresh);
        return fresh.value();
    }

    private Answer api(Credentials credentials, String method, String path, @Nullable String body,
                       @Nullable String requestId) {
        Answer answer = attempt(credentials, method, path, body, requestId);
        if (answer.status() != 401) return answer;
        tokens.remove(credentials.cacheKey());
        log.info("PayPal {} refused the cached token; retrying once with a new one", credentials.environment());
        return attempt(credentials, method, path, body, requestId);
    }

    private Answer attempt(Credentials credentials, String method, String path, @Nullable String body,
                           @Nullable String requestId) {
        HttpRequest.Builder request = HttpRequest.newBuilder(endpoint(credentials.environment(), path))
                .timeout(properties.requestTimeout())
                .header("Authorization", "Bearer " + token(credentials))
                .header("Accept", "application/json");
        if (requestId != null) request.header("PayPal-Request-Id", requestId);
        if (body == null) {
            request.GET();
        } else {
            request.header("Content-Type", "application/json").header("Prefer", "return=representation")
                    .method(method, HttpRequest.BodyPublishers.ofString(body));
        }
        return send(credentials.environment(), request.build(), MAX_API_BYTES);
    }

    private Answer send(PayPalEnvironment environment, HttpRequest request, int limit) {
        CompletableFuture<HttpResponse<byte[]>> exchange = client.sendAsync(request,
                HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(), limit));
        try {
            HttpResponse<byte[]> response = exchange.get(properties.requestTimeout().toNanos(), TimeUnit.NANOSECONDS);
            return new Answer(response.statusCode(), response.body());
        } catch (InterruptedException interrupted) {
            exchange.cancel(true);
            Thread.currentThread().interrupt();
            throw unavailable(environment, interrupted);
        } catch (TimeoutException | ExecutionException failure) {
            exchange.cancel(true);
            throw unavailable(environment, failure);
        }
    }

    private static PayPalUnavailableException unavailable(PayPalEnvironment environment, Exception failure) {
        log.warn("PayPal {} could not be reached: {}", environment, failure.getClass().getSimpleName());
        return new PayPalUnavailableException("PayPal could not be reached: " + failure.getClass().getSimpleName(),
                failure);
    }

    private static JsonNode success(Answer answer) {
        int status = answer.status();
        if (status / 100 == 2) {
            try {
                JsonNode body = JSON.readTree(answer.body());
                if (body != null && body.isObject()) return body;
            } catch (JacksonException unstructured) {
                log.debug("PayPal answered status {} without a JSON body", status);
            }
            throw new PayPalRefusedException("PayPal answered with a body that is not an object");
        }
        if (status == 429 || status / 100 == 5) {
            throw new PayPalUnavailableException("PayPal answered status " + status);
        }
        throw new PayPalRefusedException(reason(status, answer.body()));
    }

    private static boolean hasIssue(byte[] body, String issue) {
        try {
            JsonNode details = JSON.readTree(body).get("details");
            if (details == null || !details.isArray()) return false;
            for (JsonNode detail : details) {
                if (issue.equals(text(detail, "issue"))) return true;
            }
        } catch (JacksonException unstructured) {
            return false;
        }
        return false;
    }

    private static Capture captureOf(Order order) {
        return order.capture().orElseThrow(() -> new PayPalRefusedException("PayPal order has no capture"));
    }

    private static Order order(JsonNode body) {
        String id = required(body, "id");
        String status = required(body, "status");
        JsonNode unit = firstUnit(body);
        Money amount = money(unit.get("amount"));
        return new Order(id, status, text(unit, "custom_id"), amount.minor(), amount.currency(),
                approveUrl(body.get("links")), capture(body));
    }

    private static Optional<Capture> capture(JsonNode body) {
        JsonNode captures = firstUnit(body).path("payments").path("captures");
        if (!captures.isArray() || captures.isEmpty()) return Optional.empty();
        JsonNode first = captures.get(0);
        Money captured = money(first.get("amount"));
        return Optional.of(new Capture(required(first, "id"), required(first, "status"), captured.minor(),
                captured.currency()));
    }

    private static JsonNode firstUnit(JsonNode body) {
        JsonNode units = body.get("purchase_units");
        if (units == null || !units.isArray() || units.isEmpty()) {
            throw new PayPalRefusedException("PayPal order has no purchase unit");
        }
        return units.get(0);
    }

    private static Optional<URI> approveUrl(@Nullable JsonNode links) {
        if (links == null || !links.isArray()) return Optional.empty();
        for (String rel : new String[]{"payer-action", "approve"}) {
            for (JsonNode link : links) {
                if (rel.equals(text(link, "rel"))) return Optional.of(href(text(link, "href")));
            }
        }
        return Optional.empty();
    }

    private static URI href(String href) {
        try {
            URI uri = URI.create(href);
            if (("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && uri.getHost() != null) return uri;
        } catch (IllegalArgumentException malformed) {
            log.debug("PayPal sent an approve link that is not a URI");
        }
        throw new PayPalRefusedException("PayPal sent an approve link that is not a web address");
    }

    private static Money money(@Nullable JsonNode amount) {
        String code = text(amount, "currency_code");
        String value = text(amount, "value");
        Currency currency;
        try {
            currency = Currency.getInstance(code);
        } catch (IllegalArgumentException unknown) {
            throw new PayPalRefusedException("PayPal sent an unknown currency");
        }
        int digits = currency.getDefaultFractionDigits();
        if (digits < 0 || !AMOUNT.matcher(value).matches()) {
            throw new PayPalRefusedException("PayPal sent an amount that is not a decimal number");
        }
        BigDecimal decimal = new BigDecimal(value);
        if (decimal.scale() > digits) throw new PayPalRefusedException("PayPal sent an amount with extra precision");
        try {
            return new Money(decimal.movePointRight(digits).intValueExact(), currency.getCurrencyCode());
        } catch (ArithmeticException tooLarge) {
            throw new PayPalRefusedException("PayPal sent an amount that is out of range");
        }
    }

    private static String required(JsonNode node, String field) {
        String value = text(node, field);
        if (value.isEmpty()) throw new PayPalRefusedException("PayPal answered without " + field);
        return value;
    }

    private static String orderPath(String orderId) {
        if (orderId == null || !ORDER_ID.matcher(orderId).matches()) {
            throw new PayPalRefusedException("The PayPal order id is not valid");
        }
        return "/v2/checkout/orders/" + orderId;
    }

    private URI endpoint(PayPalEnvironment environment, String path) {
        String base = (environment == PayPalEnvironment.LIVE ? properties.liveEndpoint() : properties.sandboxEndpoint())
                .toString();
        return URI.create(base.replaceAll("/+$", "") + path);
    }

    static String reason(int status, byte[] body) {
        try {
            JsonNode answer = JSON.readTree(body);
            String reason = join(text(answer, "error"), text(answer, "error_description"));
            if (reason.isEmpty()) reason = join(text(answer, "name"), text(answer, "message"));
            if (!reason.isEmpty()) return bounded(reason);
        } catch (JacksonException unstructured) {
            log.debug("PayPal answered status {} without a JSON body", status);
        }
        return "HTTP " + status;
    }

    private static String join(String head, String detail) {
        return head.isEmpty() ? detail : detail.isEmpty() ? head : head + ": " + detail;
    }

    private static String text(@Nullable JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isString() ? value.asString().strip() : "";
    }

    private static String bounded(String reason) {
        String printable = reason.codePoints().filter(point -> !Character.isISOControl(point))
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();
        if (printable.length() <= MAX_REASON) return printable;
        int end = Character.isHighSurrogate(printable.charAt(MAX_REASON - 1)) ? MAX_REASON - 1 : MAX_REASON;
        return printable.substring(0, end);
    }

    record Answer(int status, byte[] body) {
    }

    private record CachedToken(String value, Instant validUntil) {
    }

    private record Money(int minor, String currency) {
    }

    public record Credentials(PayPalEnvironment environment, String clientId, String secret) {

        @Override
        public String toString() {
            return "Credentials[" + environment + "]";
        }

        private String cacheKey() {
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8));
                return environment + "|" + clientId + "|" + HexFormat.of().formatHex(digest);
            } catch (NoSuchAlgorithmException missing) {
                throw new IllegalStateException("SHA-256 is unavailable", missing);
            }
        }
    }

    public record Order(String id, String status, String customId, int amountMinor, String currency,
                        Optional<URI> approveUrl, Optional<Capture> capture) {
    }

    public record Capture(String id, String status, int amountMinor, String currency) {
    }
}
