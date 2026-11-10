package org.courtside.payment.internal;

import com.sun.net.httpserver.HttpServer;
import org.courtside.payment.PayPalEnvironment;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.Currency;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PayPalClientTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "{\"access_token\":\"tok-1\",\"expires_in\":3600}";
    private static final URI RETURN = URI.create("https://club.example.org/pay/return");
    private static final URI CANCEL = URI.create("https://club.example.org/pay/cancel");
    private static final Currency EUR = Currency.getInstance("EUR");
    private static final Currency JPY = Currency.getInstance("JPY");

    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private final Map<String, Deque<Reply>> replies = new ConcurrentHashMap<>();
    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    @Test
    void givenAnEuroAmount_whenCreatingAnOrder_thenTheBodyCarriesTheDecimalStringAndTheRedirects() throws IOException {
        // given
        UUID booking = UUID.randomUUID();
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders", 201, order("ORD1", "PAYER_ACTION_REQUIRED", booking, "12.34", "EUR", null,
                "[{\"rel\":\"self\",\"href\":\"https://x.example.org/self\"},"
                        + "{\"rel\":\"payer-action\",\"href\":\"https://paypal.example.org/approve?token=ORD1\"}]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.createOrder(credentials(), booking, 1234, EUR, RETURN, CANCEL);

        // then
        Seen create = seenFor("POST /v2/checkout/orders");
        JsonNode body = create.json();
        assertThat(body.get("intent").asString()).isEqualTo("CAPTURE");
        JsonNode unit = body.get("purchase_units").get(0);
        assertThat(unit.get("custom_id").asString()).isEqualTo(booking.toString());
        assertThat(unit.get("amount").get("currency_code").asString()).isEqualTo("EUR");
        assertThat(unit.get("amount").get("value").asString()).isEqualTo("12.34");
        JsonNode context = body.get("payment_source").get("paypal").get("experience_context");
        assertThat(context.get("return_url").asString()).isEqualTo(RETURN.toString());
        assertThat(context.get("cancel_url").asString()).isEqualTo(CANCEL.toString());
        assertThat(context.get("user_action").asString()).isEqualTo("PAY_NOW");
        assertThat(context.get("shipping_preference").asString()).isEqualTo("NO_SHIPPING");
        assertThat(create.header("PayPal-Request-Id")).isEqualTo(booking.toString());
        assertThat(create.header("Authorization")).isEqualTo("Bearer tok-1");
        assertThat(order.id()).isEqualTo("ORD1");
        assertThat(order.customId()).isEqualTo(booking.toString());
        assertThat(order.amountMinor()).isEqualTo(1234);
        assertThat(order.currency()).isEqualTo("EUR");
        assertThat(order.approveUrl()).contains(URI.create("https://paypal.example.org/approve?token=ORD1"));
        assertThat(order.capture()).isEmpty();
    }

    @Test
    void givenAZeroFractionCurrency_whenCreatingAnOrder_thenTheValueHasNoDecimalPoint() throws IOException {
        // given
        UUID booking = UUID.randomUUID();
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders", 201, order("ORD1", "CREATED", booking, "1234", "JPY", null,
                "[{\"rel\":\"approve\",\"href\":\"https://paypal.example.org/approve\"}]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.createOrder(credentials(), booking, 1234, JPY, RETURN, CANCEL);

        // then
        JsonNode amount = seenFor("POST /v2/checkout/orders").json().get("purchase_units").get(0).get("amount");
        assertThat(amount.get("value").asString()).isEqualTo("1234");
        assertThat(order.amountMinor()).isEqualTo(1234);
        assertThat(order.approveUrl()).as("the approve link is the fallback").isPresent();
    }

    @Test
    void givenACapturedOrder_whenReadingIt_thenTheFirstCaptureIsParsed() throws IOException {
        // given
        UUID booking = UUID.randomUUID();
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "COMPLETED", booking, "12.34", "EUR",
                "{\"id\":\"CAP1\",\"status\":\"COMPLETED\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"12.34\"}}",
                "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.getOrder(credentials(), "ORD1");

        // then
        assertThat(order.capture()).contains(new PayPalClient.Capture("CAP1", "COMPLETED", 1234, "EUR"));
        assertThat(seenFor("GET /v2/checkout/orders/ORD1").header("PayPal-Request-Id")).isNull();
    }

    @Test
    void givenAnApprovedOrder_whenCapturing_thenTheRequestIdIsTheOrderIdAndTheBodyIsEmptyJson() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders/ORD1/capture", 201, order("ORD1", "COMPLETED", UUID.randomUUID(), "12.34", "EUR",
                "{\"id\":\"CAP1\",\"status\":\"COMPLETED\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"12.34\"}}",
                "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Capture capture = client.captureOrder(credentials(), "ORD1");

        // then
        Seen request = seenFor("POST /v2/checkout/orders/ORD1/capture");
        assertThat(request.header("PayPal-Request-Id")).isEqualTo("ORD1");
        assertThat(request.header("Content-Type")).isEqualTo("application/json");
        assertThat(request.body()).isEqualTo("{}");
        assertThat(capture).isEqualTo(new PayPalClient.Capture("CAP1", "COMPLETED", 1234, "EUR"));
    }

    @Test
    void givenAnAlreadyCapturedOrder_whenCapturing_thenTheOrderIsReadAndItsCaptureReturned() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders/ORD1/capture", 422,
                "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"x\",\"details\":[{\"issue\":\"ORDER_ALREADY_CAPTURED\"}]}");
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "COMPLETED", UUID.randomUUID(), "12.34", "EUR",
                "{\"id\":\"CAP1\",\"status\":\"COMPLETED\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"12.34\"}}",
                "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Capture capture = client.captureOrder(credentials(), "ORD1");

        // then
        assertThat(capture.id()).isEqualTo("CAP1");
        assertThat(seen).extracting(Seen::route).containsExactly("POST /v1/oauth2/token",
                "POST /v2/checkout/orders/ORD1/capture", "GET /v2/checkout/orders/ORD1");
    }

    @Test
    void givenACaptureAnswerWithoutAUnitAmount_whenCapturing_thenTheCapturedAmountIsRead() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders/ORD1/capture", 201, "{\"id\":\"ORD1\",\"status\":\"COMPLETED\","
                + "\"purchase_units\":[{\"payments\":{\"captures\":[{\"id\":\"CAP1\",\"status\":\"COMPLETED\","
                + "\"amount\":{\"currency_code\":\"EUR\",\"value\":\"12.34\"}}]}}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Capture capture = client.captureOrder(credentials(), "ORD1");

        // then
        assertThat(capture).as("a capture answer may leave the unit amount out")
                .isEqualTo(new PayPalClient.Capture("CAP1", "COMPLETED", 1234, "EUR"));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1})
    void givenANonPositiveAmount_whenCreatingAnOrder_thenItIsACallerBugAndNothingIsSent(int amount)
            throws IOException {
        // given
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.createOrder(credentials(), UUID.randomUUID(), amount, EUR, RETURN, CANCEL))
                .as("an amount the caller should never have computed is a bug, not PayPal's refusal")
                .isInstanceOf(IllegalStateException.class);
        assertThat(seen).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"409:CONFLICT", "422:DUPLICATE_REQUEST_ID", "422:PREVIOUS_REQUEST_IN_PROGRESS",
            "400:DUPLICATE_REQUEST_ID"})
    void givenACaptureStillRunningAtPayPal_whenCapturingAgain_thenTheOutcomeIsUnknownRatherThanRefused(String answer)
            throws IOException {
        // given
        String[] parts = answer.split(":");
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders/ORD1/capture", Integer.parseInt(parts[0]),
                "{\"name\":\"X\",\"message\":\"x\",\"details\":[{\"issue\":\"" + parts[1] + "\"}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.captureOrder(credentials(), "ORD1"))
                .as("a capture PayPal may still complete must never read as a refusal")
                .isInstanceOf(PayPalUnavailableException.class);
    }

    @Test
    void givenACompletedRefund_whenRefunding_thenItCarriesTheIdAndTheRequestId() throws IOException {
        // given
        UUID requestId = UUID.randomUUID();
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", 201, "{\"id\":\"REF1\",\"status\":\"COMPLETED\"}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Refund refund = client.refundCapture(credentials(), "CAP1", requestId);

        // then
        Seen sent = seenFor("POST /v2/payments/captures/CAP1/refund");
        assertThat(sent.body()).isEqualTo("{}");
        assertThat(sent.header("PayPal-Request-Id")).isEqualTo(requestId.toString());
        assertThat(refund.id()).isEqualTo("REF1");
        assertThat(refund.status()).isEqualTo("COMPLETED");
    }

    @Test
    void givenAFullyRefundedCapture_whenRefunding_thenTheAnswerSaysSo() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", 422,
                "{\"name\":\"UNPROCESSABLE_ENTITY\",\"details\":[{\"issue\":\"CAPTURE_FULLY_REFUNDED\"}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), "CAP1", UUID.randomUUID()))
                .isInstanceOf(PayPalCaptureFullyRefundedException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"status\":\"COMPLETED\"}", "{\"id\":\"REF1\"}", "[]", "not json", ""})
    void givenARefundAnsweredWithoutAnId_whenRefunding_thenPayPalCountsAsUnavailable(String answer)
            throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", 201, answer);
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), "CAP1", UUID.randomUUID()))
                .as("an unreadable answer to a refund is unclear, never a refusal")
                .isInstanceOf(PayPalUnavailableException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"409:CONFLICT", "422:DUPLICATE_REQUEST_ID", "422:PREVIOUS_REQUEST_IN_PROGRESS",
            "400:DUPLICATE_REQUEST_ID"})
    void givenAConflictOrDuplicateRequest_whenRefunding_thenPayPalCountsAsUnavailable(String answer)
            throws IOException {
        // given
        String[] parts = answer.split(":");
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", Integer.parseInt(parts[0]),
                "{\"name\":\"X\",\"details\":[{\"issue\":\"" + parts[1] + "\"}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), "CAP1", UUID.randomUUID()))
                .as("a refund PayPal may still complete must never read as a refusal")
                .isInstanceOf(PayPalUnavailableException.class);
    }

    @Test
    void givenARefusedRefund_whenRefunding_thenTheReasonIsKept() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", 422,
                "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"REFUND_NOT_ALLOWED\","
                        + "\"details\":[{\"issue\":\"REFUND_NOT_ALLOWED\"}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), "CAP1", UUID.randomUUID()))
                .as("only the refund request's own clear refusal reads as a refused refund")
                .isInstanceOf(PayPalRefundRefusedException.class)
                .satisfies(failure -> assertThat(((PayPalRefundRefusedException) failure).reason())
                        .isEqualTo("UNPROCESSABLE_ENTITY: REFUND_NOT_ALLOWED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"token 401", "token without a token", "refund 401", "refund 403", "malformed capture id"})
    void givenARefusalThatIsNotTheRefundsOwn_whenRefunding_thenItIsNotARefusedRefund(String cause)
            throws IOException {
        // given
        String captureId = cause.equals("malformed capture id") ? "CAP/1" : "CAP1";
        switch (cause) {
            case "token 401" -> reply("POST /v1/oauth2/token", 401, "{\"error\":\"invalid_client\"}");
            case "token without a token" -> reply("POST /v1/oauth2/token", 200, "{\"expires_in\":3600}");
            default -> reply("POST /v1/oauth2/token", 200, TOKEN);
        }
        if (cause.startsWith("refund")) {
            reply("POST /v2/payments/captures/CAP1/refund", Integer.parseInt(cause.substring(7)),
                    "{\"name\":\"NOT_AUTHORIZED\",\"message\":\"denied\"}");
        }
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), captureId, UUID.randomUUID()))
                .as("%s says nothing about the refund, so it must never restore credit", cause)
                .isInstanceOf(PayPalRefusedException.class)
                .isNotInstanceOf(PayPalRefundRefusedException.class);
    }

    @Test
    void givenAFailedRefundWithAReason_whenRefunding_thenPayPalsReasonIsKept() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", 201,
                "{\"id\":\"REF1\",\"status\":\"FAILED\",\"status_details\":{\"reason\":\"ECHECK\"}}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Refund refund = client.refundCapture(credentials(), "CAP1", UUID.randomUUID());

        // then
        assertThat(refund).isEqualTo(new PayPalClient.Refund("REF1", "FAILED", "ECHECK", null, null));
    }

    @Test
    void givenAnOrderWithACompletedRefund_whenReadingIt_thenItListsTheRefund() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, orderWithRefunds("[{\"id\":\"REF1\",\"status\":\"COMPLETED\","
                + "\"amount\":{\"currency_code\":\"EUR\",\"value\":\"12.34\"}}]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.getOrder(credentials(), "ORD1");

        // then
        assertThat(order.refunds())
                .containsExactly(new PayPalClient.ListedRefund("REF1", "COMPLETED", 1234, "EUR"));
    }

    @Test
    void givenAnOrderWithoutRefunds_whenReadingIt_thenTheListIsEmpty() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "COMPLETED", UUID.randomUUID(), "1.00", "EUR", null,
                "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.getOrder(credentials(), "ORD1");

        // then
        assertThat(order.refunds()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"[{\"status\":\"COMPLETED\"}]", "[{\"id\":\"REF1\"}]", "[\"REF1\"]",
            "[{\"id\":\"REF1\",\"status\":\"COMPLETED\"}]",
            "[{\"id\":\"REF1\",\"status\":\"COMPLETED\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"x\"}}]"})
    void givenAnOrderWithAMalformedRefund_whenReadingIt_thenPayPalCountsAsUnavailable(String refunds)
            throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, orderWithRefunds(refunds));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1"))
                .as("a refund PayPal lists without id, status or a readable amount is unclear, never skipped")
                .isInstanceOf(PayPalUnavailableException.class);
    }

    @ParameterizedTest
    @ValueSource(ints = {500, 503, 429})
    void givenPayPalIsBusy_whenRefunding_thenPayPalCountsAsUnavailable(int status) throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/payments/captures/CAP1/refund", status, "{}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.refundCapture(credentials(), "CAP1", UUID.randomUUID()))
                .isInstanceOf(PayPalUnavailableException.class);
    }

    @Test
    void givenARefundId_whenReadingIt_thenStatusIdAndAmountAreReturned() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/payments/refunds/REF1", 200,
                "{\"id\":\"REF1\",\"status\":\"PENDING\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"15.00\"}}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Refund refund = client.getRefund(credentials(), "REF1");

        // then
        assertThat(refund).isEqualTo(new PayPalClient.Refund("REF1", "PENDING", null, 1500, "EUR"));
    }

    @Test
    void givenAnotherClientError_whenCapturing_thenTheReasonIsPayPalsBoundedPrintableName() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v2/checkout/orders/ORD1/capture", 422, "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"bad\\u0007 "
                + "y".repeat(500) + "\",\"details\":[{\"issue\":\"INSTRUMENT_DECLINED\"}]}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.captureOrder(credentials(), "ORD1"))
                .isInstanceOf(PayPalRefusedException.class)
                .satisfies(failure -> {
                    String reason = ((PayPalRefusedException) failure).reason();
                    assertThat(reason).startsWith("UNPROCESSABLE_ENTITY: bad ")
                            .hasSizeLessThanOrEqualTo(PayPalClient.MAX_REASON);
                    assertThat(reason.chars()).noneMatch(Character::isISOControl);
                });
    }

    @ParameterizedTest
    @ValueSource(ints = {500, 502, 503, 429})
    void givenAServerFailureOrThrottle_whenReadingAnOrder_thenPayPalIsUnavailable(int status) throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", status, "{\"name\":\"INTERNAL_SERVER_ERROR\"}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalUnavailableException.class);
    }

    @Test
    void givenAProviderThatNeverAnswers_whenReadingAnOrder_thenPayPalIsUnavailable() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        replyAfter("GET /v2/checkout/orders/ORD1", 200, "{}", Duration.ofSeconds(5));
        PayPalClient client = client(Duration.ofMillis(300));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalUnavailableException.class);
    }

    @Test
    void givenARedirect_whenReadingAnOrder_thenItIsNotFollowedAndTheTokenGoesNowhereElse() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 302, "");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1"))
                .isInstanceOf(PayPalRefusedException.class)
                .extracting(failure -> ((PayPalRefusedException) failure).reason()).isEqualTo("HTTP 302");
        assertThat(seen).extracting(Seen::route)
                .containsExactly("POST /v1/oauth2/token", "GET /v2/checkout/orders/ORD1");
    }

    @Test
    void givenTwoCalls_whenTheTokenIsStillValid_thenItIsFetchedOnce() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null, "[]"));
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null, "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        client.getOrder(credentials(), "ORD1");
        client.getOrder(credentials(), "ORD1");

        // then
        assertThat(seen).extracting(Seen::route).containsExactly("POST /v1/oauth2/token",
                "GET /v2/checkout/orders/ORD1", "GET /v2/checkout/orders/ORD1");
    }

    @Test
    void givenAnotherSecretOrAnExpiredToken_whenCalling_thenANewTokenIsFetched() throws IOException {
        // given
        MutableClock clock = new MutableClock();
        for (int call = 0; call < 3; call++) {
            reply("POST /v1/oauth2/token", 200, "{\"access_token\":\"tok-" + call + "\",\"expires_in\":120}");
            reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null, "[]"));
        }
        PayPalClient client = client(Duration.ofSeconds(2), clock);

        // when
        client.getOrder(credentials(), "ORD1");
        client.getOrder(new PayPalClient.Credentials(PayPalEnvironment.SANDBOX, "client", "other"), "ORD1");
        clock.advance(Duration.ofSeconds(61));
        client.getOrder(credentials(), "ORD1");

        // then
        assertThat(seen.stream().filter(request -> request.route().equals("POST /v1/oauth2/token")))
                .as("one token per credentials, and a refetch once less than 60 seconds remain").hasSize(3);
    }

    @Test
    void givenAnRevokedToken_whenCalling_thenItIsDroppedAndTheCallRetriedOnce() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, "{\"access_token\":\"old\",\"expires_in\":3600}");
        reply("POST /v1/oauth2/token", 200, "{\"access_token\":\"new\",\"expires_in\":3600}");
        reply("GET /v2/checkout/orders/ORD1", 401, "{\"name\":\"AUTHENTICATION_FAILURE\"}");
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null, "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when
        PayPalClient.Order order = client.getOrder(credentials(), "ORD1");

        // then
        assertThat(order.status()).isEqualTo("APPROVED");
        assertThat(seen).extracting(request -> request.header("Authorization"))
                .containsExactly("Basic Y2xpZW50OnNlY3JldA==", "Bearer old", "Basic Y2xpZW50OnNlY3JldA==", "Bearer new");
    }

    @Test
    void givenATokenThatIsRefusedTwice_whenCalling_thenTheSecondRefusalIsFinal() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 401, "{\"name\":\"AUTHENTICATION_FAILURE\"}");
        reply("GET /v2/checkout/orders/ORD1", 401, "{\"name\":\"AUTHENTICATION_FAILURE\"}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class);
        assertThat(seen.stream().filter(request -> request.route().startsWith("GET"))).hasSize(2);
    }

    @Test
    void givenRefusedCredentials_whenCalling_thenTheTokenReasonIsReportedAndNoApiCallIsMade() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 401, "{\"error\":\"invalid_client\",\"error_description\":\"Client Authentication failed\"}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1"))
                .isInstanceOf(PayPalRefusedException.class)
                .extracting(failure -> ((PayPalRefusedException) failure).reason())
                .isEqualTo("invalid_client: Client Authentication failed");
        assertThat(seen).hasSize(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"12.345", "12.3x", "abc", "-1.00", "1e2", "", "99999999999.00"})
    void givenAMalformedOrOverPreciseAmount_whenReadingAnOrder_thenItIsRefusedWithoutAnUnexpectedException(String value)
            throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), value, "EUR", null, "[]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class);
    }

    @Test
    void givenAnUnknownCurrencyOrAnEmptyAnswer_whenReadingAnOrder_thenItIsRefused() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "ZZZ", null, "[]"));
        reply("GET /v2/checkout/orders/ORD1", 200, "{}");
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class);
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"javascript:alert(1)", "not a uri", "/relative"})
    void givenAnApproveLinkThatIsNotAWebAddress_whenReadingAnOrder_thenItIsRefused(String href) throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "CREATED", UUID.randomUUID(), "1.00", "EUR", null,
                "[{\"rel\":\"approve\",\"href\":\"" + href + "\"}]"));
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://www.paypal.com/checkoutnow?token=ORD1", "https://paypal.com.example.org/x",
            "https://example.org/checkoutnow", "https://evilpaypal.com/checkoutnow"})
    void givenProductionAndAnApproveLinkOffPayPal_whenReadingAnOrder_thenItIsRefused(String href) throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "CREATED", UUID.randomUUID(), "1.00", "EUR", null,
                "[{\"rel\":\"approve\",\"href\":\"" + href + "\"}]"));
        PayPalClient client = client(Duration.ofSeconds(2), new MutableClock(), true);

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1")).isInstanceOf(PayPalRefusedException.class)
                .hasMessage("PayPal sent an approve link outside paypal.com");
    }

    @ParameterizedTest
    @CsvSource({"true,https://www.sandbox.paypal.com/checkoutnow?token=ORD1",
            "true,https://PayPal.com/checkoutnow?token=ORD1",
            "false,http://paypal-sandbox.test:8080/approve?token=ORD1"})
    void givenAnApproveLinkTheEnvironmentAllows_whenReadingAnOrder_thenItIsKept(boolean production, String href)
            throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "CREATED", UUID.randomUUID(), "1.00", "EUR", null,
                "[{\"rel\":\"approve\",\"href\":\"" + href + "\"}]"));
        PayPalClient client = client(Duration.ofSeconds(2), new MutableClock(), production);

        // when
        PayPalClient.Order order = client.getOrder(credentials(), "ORD1");

        // then
        assertThat(order.approveUrl()).contains(URI.create(href));
    }

    @Test
    void givenAnOrderIdThatIsNotAnIdentifier_whenCalling_thenNothingIsSent() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "../v1/identity")).isInstanceOf(PayPalRefusedException.class);
        assertThatThrownBy(() -> client.captureOrder(credentials(), "")).isInstanceOf(PayPalRefusedException.class);
        assertThat(seen).isEmpty();
    }

    @Test
    void whenPrintingCredentials_thenTheSecretIsNotIncluded() {
        // when
        String printed = new PayPalClient.Credentials(PayPalEnvironment.LIVE, "client", "hunter2-secret").toString();

        // then
        assertThat(printed).doesNotContain("hunter2-secret");
    }

    @Test
    void givenAUsedUpDeadline_whenReadingAnOrder_thenNothingIsSent() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        PayPalClient client = client(Duration.ofSeconds(2));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1", PayPalDeadline.after(Duration.ZERO)))
                .isInstanceOf(PayPalUnavailableException.class);
        assertThat(seen).as("a request the deadline leaves no time for is never sent").isEmpty();
    }

    @Test
    void givenASlowTokenEndpoint_whenTheDeadlineIsShorter_thenTheTokenRequestIsCutAndTheOrderIsNotRead()
            throws IOException {
        // given
        replyAfter("POST /v1/oauth2/token", 200, TOKEN, Duration.ofSeconds(3));
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null,
                "[]"));
        PayPalClient client = client(Duration.ofSeconds(5));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1", PayPalDeadline.after(Duration.ofMillis(300))))
                .isInstanceOf(PayPalUnavailableException.class);
        assertThat(seen).extracting(Seen::route).as("the token request ran into the deadline")
                .containsExactly("POST /v1/oauth2/token");
    }

    @Test
    void givenACachedTokenRefused_whenTheRetryWouldOutlastTheDeadline_thenTheCallIsCut() throws IOException {
        // given
        reply("POST /v1/oauth2/token", 200, TOKEN);
        PayPalClient client = client(Duration.ofSeconds(5));
        reply("GET /v2/checkout/orders/ORD0", 200, order("ORD0", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null,
                "[]"));
        client.getOrder(credentials(), "ORD0");
        replies.put("POST /v1/oauth2/token", new ArrayDeque<>());
        replyAfter("POST /v1/oauth2/token", 200, TOKEN, Duration.ofSeconds(3));
        replyAfter("GET /v2/checkout/orders/ORD1", 401, "{}", Duration.ofMillis(100));
        reply("GET /v2/checkout/orders/ORD1", 200, order("ORD1", "APPROVED", UUID.randomUUID(), "1.00", "EUR", null,
                "[]"));

        // when / then
        assertThatThrownBy(() -> client.getOrder(credentials(), "ORD1", PayPalDeadline.after(Duration.ofMillis(800))))
                .as("without the deadline the new token comes after three seconds and the read succeeds")
                .isInstanceOf(PayPalUnavailableException.class);
    }

    private PayPalClient.Credentials credentials() {
        return new PayPalClient.Credentials(PayPalEnvironment.SANDBOX, "client", "secret");
    }

    private PayPalClient client(Duration timeout) throws IOException {
        return client(timeout, new MutableClock());
    }

    private PayPalClient client(Duration timeout, Clock clock) throws IOException {
        return client(timeout, clock, false);
    }

    private PayPalClient client(Duration timeout, Clock clock, boolean production) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String route = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
            seen.add(new Seen(route, exchange.getRequestHeaders().entrySet().stream().collect(
                    java.util.stream.Collectors.toMap(entry -> entry.getKey().toLowerCase(java.util.Locale.ROOT),
                            entry -> entry.getValue().get(0), (first, second) -> first)),
                    new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            Deque<Reply> queue = replies.get(route);
            Reply reply = queue == null ? null : queue.size() > 1 ? queue.poll() : queue.peek();
            if (reply == null) reply = new Reply(404, "{}", Duration.ZERO);
            try {
                Thread.sleep(reply.delay().toMillis());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            byte[] answer = reply.body().getBytes(StandardCharsets.UTF_8);
            if (reply.status() / 100 == 3) exchange.getResponseHeaders().add("Location", "/elsewhere");
            exchange.sendResponseHeaders(reply.status(), answer.length == 0 ? -1 : answer.length);
            if (answer.length > 0) exchange.getResponseBody().write(answer);
            exchange.close();
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        return new PayPalClient(new PayPalProperties(endpoint, endpoint, timeout, Duration.ofSeconds(30)), clock, production);
    }

    private void reply(String route, int status, String body) {
        replyAfter(route, status, body, Duration.ZERO);
    }

    private void replyAfter(String route, int status, String body, Duration delay) {
        replies.computeIfAbsent(route, key -> new ArrayDeque<>()).add(new Reply(status, body, delay));
    }

    private Seen seenFor(String route) {
        return seen.stream().filter(request -> request.route().equals(route)).findFirst()
                .orElseThrow(() -> new AssertionError("no request for " + route));
    }

    private static String orderWithRefunds(String refunds) {
        return order("ORD1", "COMPLETED", UUID.randomUUID(), "1.00", "EUR", null, "[]")
                .replace("}}],\"links\"", "},\"payments\":{\"refunds\":" + refunds + "}}],\"links\"");
    }

    private static String order(String id, String status, UUID booking, String value, String currency, String capture,
                                String links) {
        String payments = capture == null ? "" : ",\"payments\":{\"captures\":[" + capture + "]}";
        return "{\"id\":\"" + id + "\",\"status\":\"" + status + "\",\"purchase_units\":[{\"custom_id\":\"" + booking
                + "\",\"amount\":{\"currency_code\":\"" + currency + "\",\"value\":\"" + value + "\"}" + payments
                + "}],\"links\":" + links + "}";
    }

    private record Reply(int status, String body, Duration delay) {
    }

    private record Seen(String route, Map<String, String> headers, String body) {

        String header(String name) {
            return headers.get(name.toLowerCase(java.util.Locale.ROOT));
        }

        JsonNode json() {
            return JSON.readTree(body);
        }
    }

    private static final class MutableClock extends Clock {

        private Instant now = Instant.parse("2026-01-01T00:00:00Z");

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
