package org.courtside.payment.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.payment.PayPalEnvironment;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
public class PayPalConnectionCheck {

    static final int MAX_REASON = 200;
    private static final int MAX_RESPONSE_BYTES = 16_384;

    private final PayPalProperties properties;
    private final HttpClient client;
    private final ObjectMapper json = new ObjectMapper();

    PayPalConnectionCheck(PayPalProperties properties) {
        this.properties = properties;
        this.client = HttpClient.newBuilder().connectTimeout(properties.requestTimeout()).build();
    }

    Result check(PayPalEnvironment environment, String clientId, String secret) {
        String credentials = Base64.getEncoder()
                .encodeToString((clientId + ":" + secret).getBytes(StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder(tokenEndpoint(environment))
                .timeout(properties.requestTimeout())
                .header("Authorization", "Basic " + credentials)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials"))
                .build();
        CompletableFuture<HttpResponse<byte[]>> exchange = client.sendAsync(request,
                HttpResponse.BodyHandlers.limiting(HttpResponse.BodyHandlers.ofByteArray(), MAX_RESPONSE_BYTES));
        try {
            HttpResponse<byte[]> response = exchange.get(properties.requestTimeout().toNanos(), TimeUnit.NANOSECONDS);
            if (response.statusCode() / 100 == 2) {
                log.info("PayPal {} accepted the stored credentials", environment);
                return new Result(Outcome.OK, null);
            }
            log.info("PayPal {} refused the stored credentials with status {}", environment, response.statusCode());
            return new Result(Outcome.REJECTED, reason(response.statusCode(), response.body()));
        } catch (InterruptedException interrupted) {
            exchange.cancel(true);
            Thread.currentThread().interrupt();
            return unreachable(environment, interrupted);
        } catch (TimeoutException | ExecutionException failure) {
            exchange.cancel(true);
            return unreachable(environment, failure);
        }
    }

    private URI tokenEndpoint(PayPalEnvironment environment) {
        String base = (environment == PayPalEnvironment.LIVE ? properties.liveEndpoint() : properties.sandboxEndpoint())
                .toString();
        return URI.create(base.replaceAll("/+$", "") + "/v1/oauth2/token");
    }

    private static Result unreachable(PayPalEnvironment environment, Exception failure) {
        log.warn("PayPal {} could not be reached: {}", environment, failure.getClass().getSimpleName());
        return new Result(Outcome.UNREACHABLE, null);
    }

    private String reason(int status, byte[] body) {
        try {
            JsonNode answer = json.readTree(body);
            String error = text(answer, "error");
            String description = text(answer, "error_description");
            String reason = error.isEmpty() ? description : description.isEmpty() ? error : error + ": " + description;
            if (!reason.isEmpty()) return bounded(reason);
        } catch (JacksonException unstructured) {
            log.debug("PayPal answered status {} without a JSON body", status);
        }
        return "HTTP " + status;
    }

    private static String text(JsonNode answer, String field) {
        JsonNode value = answer == null ? null : answer.get(field);
        return value != null && value.isString() ? value.asString().strip() : "";
    }

    private static String bounded(String reason) {
        String printable = reason.codePoints().filter(point -> !Character.isISOControl(point))
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();
        if (printable.length() <= MAX_REASON) return printable;
        int end = Character.isHighSurrogate(printable.charAt(MAX_REASON - 1)) ? MAX_REASON - 1 : MAX_REASON;
        return printable.substring(0, end);
    }

    public enum Outcome { OK, REJECTED, UNREACHABLE, NOT_CONFIGURED }

    public record Result(Outcome outcome, @Nullable String providerReason) {
    }
}
