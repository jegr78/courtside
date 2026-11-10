package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.internal.PayPalReconciliation;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.payment.FakePayPal.CAPTURE;
import static org.courtside.payment.FakePayPal.CREATE;
import static org.courtside.payment.FakePayPal.ORDER;
import static org.courtside.payment.FakePayPal.READ;
import static org.courtside.payment.FakePayPal.REFUND;
import static org.courtside.payment.FakePayPal.REFUND_READ;
import static org.courtside.payment.FakePayPal.TOKEN;
import static org.courtside.payment.FakePayPal.capture;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "courtside.payment.paypal.request-timeout=1s"})
class PayPalReconciliationTest extends AbstractIntegrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String LIVE_READ = "GET /live/v2/checkout/orders/" + ORDER;
    private static final String UNAVAILABLE = "{\"name\":\"SERVICE_UNAVAILABLE\",\"message\":\"down\"}";
    private static final String FULLY_REFUNDED = "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"refunded\","
            + "\"details\":[{\"issue\":\"CAPTURE_FULLY_REFUNDED\"}]}";
    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");
    private static final FakePayPal PAYPAL = new FakePayPal();

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private BookingService bookingService;
    @Autowired
    private PayPalReconciliation reconciliation;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private CardTestFixture cards;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private CreditTestFixture credit;
    @Autowired
    private PaymentTestFixture payment;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID johnPerson;
    private UUID johnAccount;
    private UUID adminAccount;
    private UUID winterHall;

    @DynamicPropertySource
    static void endpoints(DynamicPropertyRegistry registry) {
        String base = "http://127.0.0.1:" + PAYPAL.port();
        registry.add("courtside.payment.paypal.sandbox-endpoint", () -> base + "/sandbox");
        registry.add("courtside.payment.paypal.live-endpoint", () -> base + "/live");
    }

    @AfterAll
    static void stop() {
        PAYPAL.stop();
    }

    @BeforeEach
    void setUp() {
        PAYPAL.reset();
        PAYPAL.reply(TOKEN, 200, "{\"access_token\":\"token-1\",\"expires_in\":3600}");
        PAYPAL.reply("POST /live/v1/oauth2/token", 200, "{\"access_token\":\"token-2\",\"expires_in\":3600}");
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        johnPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(johnPerson, "roe.john", Set.of(Role.EXTERNAL));
        adminAccount = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.MEMBER, Role.ADMIN));
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard.miles@example.org"),
                "miles.richard", Set.of(Role.MEMBER, Role.TREASURER));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(winterHall, 1500);
        payment.storePayPalCredentials("SANDBOX", "client-sandbox", "paypal-secret-value");
    }

    @Test
    void givenAnApprovedOrderNeverReturned_whenTheJobRuns_thenTheBookingIsConfirmed() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(6));
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("the job captures what the payer approved").hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(entries(booking)).containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(audit("payment.paypal.captured", booking)).hasSize(1);
        assertThat(captureAttempted()).as("the attempt is stored before the capture is sent").isTrue();
    }

    @Test
    void givenAYoungApprovedOrder_whenTheJobRuns_thenTheReturnIsGivenItsTime() {
        // given
        UUID booking = bookWithOrderQuietly();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(READ)).as("an order younger than five minutes is left to the return").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
    }

    @Test
    void givenACompletedOrder_whenTheJobRuns_thenItConfirmsWithoutCapturingAgain() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(6));
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("a completed order is never captured twice").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(entries(booking)).hasSize(2);
        assertThat(audit("payment.paypal.captured", booking)).hasSize(1);
    }

    @Test
    void givenAnUnapprovedOrderBeforeTheDeadline_whenTheJobRuns_thenThePayerKeepsTheirTime() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(6));
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(READ)).hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(audit("payment.paypal.voided", booking)).isEmpty();
    }

    @Test
    void givenAnUnapprovedOrderPastTheDeadline_whenTheJobRuns_thenTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).as("the court is free").isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("HOLD_EXPIRED"));
        assertThat(audit("booking.payment.expired", booking)).hasSize(1);
        assertThat(audit("payment.paypal.rejected", booking)).as("a void is not a refusal").isEmpty();
    }

    @Test
    void givenACaptureStartingWhileTheJobReads_whenTheJobVoids_thenTheOrderStaysOpenWithItsCourt() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));
        PAYPAL.onNext(READ, () -> jdbc.sql("UPDATE paypal_order SET capture_attempted_at = now()").update());

        // when
        reconciliation.run();

        // then
        assertThat(orderStatus()).as("a capture attempt seen under the lock stops the void").isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(audit("payment.paypal.voided", booking)).isEmpty();
    }

    @Test
    void givenPayPalDown_whenTheJobMeetsThreeUnreachableOrders_thenTheRunStopsAndTheRestWait() {
        // given
        List<String> open = List.of("ORDERA", "ORDERB", "ORDERC", "ORDERD", "ORDERE");
        open.forEach(orderId -> {
            storeAttemptedOrder(orderId, "EUR");
            PAYPAL.reply(readOf(orderId), 503, UNAVAILABLE);
        });

        // when
        reconciliation.run();

        // then
        assertThat(open.stream().mapToInt(orderId -> PAYPAL.seen(readOf(orderId)).size()).sum())
                .as("an outage costs a run at most three PayPal calls").isEqualTo(3);
        assertThat(jdbc.sql("SELECT count(*) FROM paypal_order WHERE status = 'CREATED'").query(Integer.class).single())
                .isEqualTo(5);
    }

    @Test
    void givenAPendingRefundWithoutAnswer_whenTheJobRuns_thenItRetriesWithTheSameRequestIdAndRecordsTheRefund()
            throws Exception {
        // given
        UUID booking = pendingRefund(500, "{}");
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        PAYPAL.replaceReply(REFUND, 201, FakePayPal.refund("COMPLETED"));
        int asked = PAYPAL.seen(REFUND).size();

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(REFUND)).as("the job repeats the unanswered request").hasSize(asked + 1)
                .extracting(request -> request.header("PayPal-Request-Id"))
                .as("the repeat carries the same request id").containsOnly(refundRow().get("id").toString());
        assertThat(refundRow()).containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND1");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(audit("payment.paypal.refunded", booking)).hasSize(1);
    }

    @Test
    void givenAPendingRefundPayPalCompleted_whenTheJobRuns_thenItIsCompleted() throws Exception {
        // given
        UUID booking = pendingRefund(201, FakePayPal.refund("PENDING"));
        PAYPAL.reply(REFUND_READ, 200, FakePayPal.refund("COMPLETED"));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(REFUND_READ)).as("a known refund is read, not requested again").hasSize(1);
        assertThat(PAYPAL.seen(REFUND)).hasSize(1);
        assertThat(refundRow()).containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND1");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(audit("payment.paypal.refunded", booking)).hasSize(1);
    }

    @Test
    void givenAPendingRefundPayPalFailed_whenTheJobRuns_thenTheCreditIsRestored() throws Exception {
        // given
        UUID booking = pendingRefund(201, FakePayPal.refund("PENDING"));
        PAYPAL.reply(REFUND_READ, 200, FakePayPal.refund("FAILED"));

        // when
        reconciliation.run();

        // then
        assertThat(refundRow()).containsEntry("status", "FAILED").containsEntry("refund_id", "REFUND1")
                .containsEntry("failure_reason", "PayPal reports the refund as FAILED");
        assertThat(credit.balance(johnAccount)).as("a failed refund gives the credit back").isEqualTo(1500);
        assertThat(entries(booking)).contains(Map.of("kind", "PAYPAL_REFUND_REVERSED", "amount_minor", 1500));
        assertThat(audit("payment.paypal.refundFailed", booking)).hasSize(1);
    }

    @Test
    void givenAPendingRefundAnsweredFullyRefunded_whenTheJobRuns_thenItIsCompletedWithoutRestoringCredit()
            throws Exception {
        // given
        UUID booking = pendingRefund(500, "{}");
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        PAYPAL.reply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "COMPLETED", "15.00"));
        PAYPAL.replaceReply(REFUND, 422, FULLY_REFUNDED);

        // when
        reconciliation.run();

        // then
        assertThat(refundRow()).containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND7");
        assertThat(credit.balance(johnAccount)).as("the credit stays taken").isZero();
        assertThat(entries(booking)).noneMatch(entry -> entry.get("kind").equals("PAYPAL_REFUND_REVERSED"));
        assertThat(audit("payment.paypal.refunded", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("refundId").asString()).isEqualTo("REFUND7"));
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void givenPayPalDown_whenTheJobRuns_thenThePendingRefundStaysAndTheRunStops(CapturedOutput output) {
        // given
        List<String> open = List.of("ORDERA", "ORDERB");
        open.forEach(orderId -> {
            storeAttemptedOrder(orderId, "EUR");
            PAYPAL.reply(readOf(orderId), 503, UNAVAILABLE);
        });
        List<String> refunded = List.of("ORDERR", "ORDERS", "ORDERT");
        List<UUID> refunds = refunded.stream().map(orderId -> storePendingRefund(orderId, "EUR", refunded.indexOf(orderId)))
                .toList();
        refunded.forEach(orderId -> PAYPAL.reply(refundReadOf(orderId), 503, UNAVAILABLE));

        // when
        reconciliation.run();

        // then
        assertThat(refunded.stream().map(orderId -> PAYPAL.seen(refundReadOf(orderId)).size()))
                .as("the orders' outage counts toward the refunds' stop").containsExactly(1, 0, 0);
        assertThat(jdbc.sql("SELECT status FROM paypal_refund").query(String.class).list())
                .as("an unreachable PayPal leaves every refund pending").containsOnly("PENDING").hasSize(3);
        assertThat(refundUpdatedAt(refunds.getFirst())).as("the unread refund moves to the back")
                .isEqualTo(clock.instant());
        assertThat(refundUpdatedAt(refunds.get(1))).as("an unasked refund keeps its place")
                .isBefore(clock.instant());
        assertThat(output.getOut()).as("each unread refund leaves a warning naming it and its order")
                .contains("PayPal refund " + refunds.getFirst() + " of order ORDERR could not be read");
    }

    @Test
    void givenAPendingRefundPayPalWillNotShow_whenTheJobRuns_thenItStaysPendingAndMovesToTheBackOfThePage()
            throws Exception {
        // given
        UUID booking = pendingRefund(201, FakePayPal.refund("PENDING"));
        PAYPAL.reply(REFUND_READ, 403, "{\"name\":\"NOT_AUTHORIZED\",\"message\":\"denied\"}");

        // when
        reconciliation.run();

        // then
        assertThat(refundRow()).containsEntry("status", "PENDING");
        assertThat(refundUpdatedAt((UUID) refundRow().get("id"))).as("a refund still unclear is touched so others"
                + " come first").isEqualTo(clock.instant());
        assertThat(entries(booking)).noneMatch(entry -> entry.get("kind").equals("PAYPAL_REFUND_REVERSED"));
    }

    @Test
    void givenAPendingRefundThatFailsEveryRun_whenTheJobRuns_thenItMovesToTheBackOfThePage() {
        // given
        UUID refund = storePendingRefund("ORDERQ", "QQQ", 0);

        // when
        reconciliation.run();

        // then
        assertThat(refundUpdatedAt(refund)).as("a failing refund is touched so others come first")
                .isEqualTo(clock.instant());
        assertThat(jdbc.sql("SELECT status FROM paypal_refund").query(String.class).single()).isEqualTo("PENDING");
    }

    @Test
    void givenAnOrderThatFailsEveryRun_whenTheJobRuns_thenItMovesToTheBackOfThePage() {
        // given
        storeAttemptedOrder("ORDERQ", "QQQ");

        // when
        reconciliation.run();

        // then
        assertThat(jdbc.sql("SELECT updated_at FROM paypal_order WHERE order_id = 'ORDERQ'").query(Timestamp.class)
                .single().toInstant()).as("a failing order is touched so others come first").isEqualTo(clock.instant());
    }

    @Test
    void givenAnOpenOrderThatCannotBeRead_whenTheEnvironmentChanges_thenTheSaveStillSucceeds() throws Exception {
        // given
        storeAttemptedOrder("ORDERQ", "QQQ");

        // when
        saveSettings("client-live", "LIVE", true, "paypal-secret-live")

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.environment").value("LIVE"));
        assertThat(jdbc.sql("SELECT status FROM paypal_order WHERE order_id = 'ORDERQ'").query(String.class).single())
                .as("the order is left to the job").isEqualTo("CREATED");
    }

    @Test
    void givenAnApprovedOrderAndPayPalDown_whenTheDeadlinePasses_thenTheBookingStaysHeld() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 503, UNAVAILABLE);

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(READ)).as("the job asked PayPal").hasSize(1);
        assertThat(bookingStatus(booking)).as("an order PayPal cannot show keeps its court").isEqualTo("PENDING_PAYMENT");
        assertThat(allocationStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).isEmpty();
    }

    @Test
    void givenAnApprovedOrderPastTheDeadline_whenItsBookingIsStillHeld_thenTheJobCapturesAndConfirms()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("the court was never given away, so the approval is captured")
                .hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(entries(booking)).containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(audit("payment.paypal.captured", booking)).hasSize(1);
    }

    @Test
    void givenAPendingBookingWithoutAnOrder_whenTheDeadlinePasses_thenTheCourtIsFree() {
        // given
        UUID booking = book();
        expire(booking);

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.all()).as("a booking without an order has nothing to ask PayPal").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(audit("booking.payment.expired", booking)).hasSize(1);
    }

    @Test
    void givenAPendingBookingWithoutAnOrderBeforeTheDeadline_whenTheJobRuns_thenItStaysHeld() {
        // given
        UUID booking = book();

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(audit("booking.payment.expired", booking)).isEmpty();
    }

    @Test
    void givenAnOpenOrder_whenPayPalIsSwitchedOff_thenItIsVoidedAndTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));

        // when
        saveSettings("client-sandbox", "SANDBOX", false, null).andExpect(status().isOk());

        // then
        assertThat(PAYPAL.seen(READ)).as("an order nobody tried to capture holds no money").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement().satisfies(payload ->
                assertThat(payload.get("reason").asString()).isEqualTo("CREDENTIALS_CHANGED"));
    }

    @Test
    void givenAnOpenOrder_whenTheCredentialsAreRemoved_thenItIsVoidedAndTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));

        // when
        mockMvc.perform(delete("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("miles.richard")))
                        .with(csrf()).sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()))
                .andExpect(status().isNoContent());

        // then
        assertThat(PAYPAL.seen(READ)).as("an order nobody tried to capture holds no money").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement().satisfies(payload ->
                assertThat(payload.get("reason").asString()).isEqualTo("CREDENTIALS_CHANGED"));
    }

    @Test
    void givenAnUnattemptedOrderAndPayPalDown_whenTheEnvironmentChanges_thenItIsVoidedAndTheCourtIsFree()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 503, UNAVAILABLE);

        // when
        saveSettings("client-live", "LIVE", true, "paypal-secret-live").andExpect(status().isOk());

        // then
        assertThat(PAYPAL.seen(READ)).as("without a capture call no money can have moved").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement().satisfies(payload ->
                assertThat(payload.get("reason").asString()).isEqualTo("CREDENTIALS_CHANGED"));
    }

    @Test
    void givenAnAttemptedOrderAndPayPalDown_whenTheEnvironmentChanges_thenItStaysOpenWithItsCourt() throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 503, UNAVAILABLE);

        // when
        saveSettings("client-live", "LIVE", true, "paypal-secret-live").andExpect(status().isOk());

        // then
        assertThat(orderStatus()).as("an order that may hold money is never voided unread").isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(audit("payment.paypal.voided", booking)).isEmpty();
    }

    @Test
    void givenAnAttemptedOrderUnreadableForADay_whenTheJobRuns_thenTheCourtIsFreeAndALaterCaptureBecomesCredit()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 503, UNAVAILABLE);
        age(Duration.ofHours(25));
        expire(booking, Duration.ofHours(24).plusSeconds(1));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).as("a day after its deadline the court is freed").isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(orderStatus()).as("the order stays open for a capture PayPal may still show").isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        reconciliation.run();
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenAnAttemptedOrderUnreadableForLessThanADay_whenTheJobRuns_thenTheCourtStaysHeld() throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 503, UNAVAILABLE);
        age(Duration.ofHours(23));
        expire(booking, Duration.ofHours(23));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
    }

    @Test
    void givenAnUnattemptedApprovedOrderUnreadableForADay_whenTheJobRuns_thenItIsVoidedAndTheCourtIsFree() {
        // given
        UUID booking = bookWithOrderQuietly();
        PAYPAL.reply(READ, 503, UNAVAILABLE);
        age(Duration.ofHours(25));
        expire(booking, Duration.ofHours(24).plusSeconds(1));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(READ)).as("the job tried to read it first").hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("HOLD_EXPIRED"));
    }

    @Test
    void givenAnOpenOrderWithACapture_whenTheEnvironmentChanges_thenItIsRecordedNotVoided() throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        int readsBefore = PAYPAL.seen(READ).size();

        // when
        saveSettings("client-live", "LIVE", true, "paypal-secret-live").andExpect(status().isOk());

        // then
        assertThat(PAYPAL.seen(READ)).as("the order is read with the credentials it was created with")
                .hasSize(readsBefore + 1);
        assertThat(PAYPAL.seen(LIVE_READ)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(entries(booking)).containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(audit("payment.paypal.voided", booking)).isEmpty();
    }

    @Test
    void givenACaptureRacingTheExpiry_whenBothRun_thenEitherConfirmedOrCreditedNeverBoth() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        CountDownLatch heldCapture = PAYPAL.holdFirst(CAPTURE);
        CompletableFuture<String> returned = CompletableFuture.supplyAsync(this::captureOutcome);
        awaitRequest(CAPTURE);

        // when
        reconciliation.run();
        heldCapture.countDown();

        // then
        assertThat(returned.get(10, TimeUnit.SECONDS)).isEqualTo("LATE_CREDITED");
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).as("the money is credit, not a booking as well")
                .containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(audit("booking.booking.confirmed", booking)).isEmpty();
        assertThat(audit("payment.paypal.lateCapture", booking)).hasSize(1);
    }

    @Test
    void givenABookingReleasedByTheBoardAfterACaptureTimeout_whenTheJobFindsTheCapture_thenItIsCreditedAsLate()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN), CancellationReason.WEATHER);
        assertThat(orderStatus()).as("the board's cancel leaves the order to the job").isEqualTo("CREATED");
        age(Duration.ofMinutes(6));
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(audit("payment.paypal.lateCapture", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("credited").asBoolean()).isTrue());
    }

    @Test
    void givenABookingReleasedByTheBoard_whenTheJobFindsNoCapture_thenTheOrderIsVoided() throws Exception {
        // given
        UUID booking = bookWithOrder();
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN), CancellationReason.WEATHER);
        age(Duration.ofMinutes(6));
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("a released booking is never captured").isEmpty();
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.voided", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("BOOKING_RELEASED"));
    }

    @Test
    void givenAVoidedOrderWithACaptureAttempt_whenPayPalShowsTheCapture_thenItIsCreditedAsLate() throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 200, order("APPROVED", booking, null));
        cancel().andExpect(jsonPath("$.outcome").value("REJECTED"));
        assertThat(orderStatus()).isEqualTo("VOIDED");
        age(Duration.ofMinutes(6));
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(audit("payment.paypal.lateCapture", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("credited").asBoolean()).isTrue());
    }

    @Test
    void givenAVoidedOrderWithoutACaptureAttempt_whenTheJobRuns_thenPayPalIsNotAsked() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, null));
        cancel().andExpect(jsonPath("$.outcome").value("REJECTED"));
        age(Duration.ofMinutes(6));
        int readsBefore = PAYPAL.seen(READ).size();

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(READ)).as("an order nobody tried to capture cannot have been captured")
                .hasSize(readsBefore);
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenACapturePendingAtPayPal_whenADayPassesAfterTheDeadline_thenTheCourtIsFreeAndALaterCompletionIsCredit()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        pendTheCapture(booking);
        age(Duration.ofHours(24));
        expire(booking, Duration.ofHours(23));
        reconciliation.run();
        assertThat(bookingStatus(booking)).as("within a day of its deadline the court stays held")
                .isEqualTo("PENDING_PAYMENT");
        expire(booking, Duration.ofHours(24).plusSeconds(1));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).as("a capture PayPal keeps pending holds the court no longer than a day")
                .isEqualTo("CANCELLED");
        assertThat(orderStatus()).as("the order stays open for the capture to finish").isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        age(Duration.ofMinutes(6));
        reconciliation.run();
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenACompletedOrderWithoutAVisibleCapture_whenADayPassesAfterTheDeadline_thenTheOrderIsStillReadLater()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, null));
        age(Duration.ofHours(25));
        expire(booking, Duration.ofHours(24).plusSeconds(1));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(captureAttempted()).as("an order that may hold money is never voided unread").isTrue();
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        age(Duration.ofMinutes(6));
        reconciliation.run();
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenACapturePendingAtPayPalForABookingSoonToStart_whenItStarts_thenTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        pendTheCapture(booking);
        age(Duration.ofMinutes(20));
        expire(booking, Duration.ofMinutes(5));
        startIn(booking, Duration.ofHours(2));
        reconciliation.run();
        assertThat(bookingStatus(booking)).as("before its start the court stays held").isEqualTo("PENDING_PAYMENT");
        startIn(booking, Duration.ofMinutes(-1));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).as("a hold never outlives the start of its booking").isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("CREATED");
    }

    @Test
    void givenACaptureCompletingAfterTheBookingStarted_whenTheJobRecordsIt_thenItIsCreditAndNotAConfirmation()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        age(Duration.ofMinutes(6));
        startIn(booking, Duration.ofMinutes(-1));

        // when
        reconciliation.run();

        // then
        assertThat(bookingStatus(booking)).as("a session that has begun is never confirmed").isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(audit("booking.booking.confirmed", booking))
                .as("the confirmation mail follows only this event").isEmpty();
    }

    @Test
    void givenAnApprovedOrderOfABookingThatHasStarted_whenTheJobRuns_thenNothingIsCapturedAndTheCourtIsFree()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        age(Duration.ofMinutes(6));
        startIn(booking, Duration.ofMinutes(-1));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("a session that has begun is never charged").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
    }

    private void pendTheCapture(UUID booking) throws Exception {
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, capture("PENDING", "15.00")));
        captureRequest().andExpect(jsonPath("$.outcome").value("PROCESSING"));
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, capture("PENDING", "15.00")));
    }

    private void startIn(UUID booking, Duration fromNow) {
        Instant start = clock.instant().plus(fromNow);
        jdbc.sql("UPDATE court_allocation SET starts_at = :start, ends_at = :end WHERE booking_id = :id")
                .param("start", Timestamp.from(start)).param("end", Timestamp.from(start.plus(Duration.ofHours(1))))
                .param("id", booking).update();
    }

    private UUID book() {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall,
                new TimeSlot(TOMORROW_AFTERNOON, TOMORROW_AFTERNOON.plus(Duration.ofHours(1))), johnAccount,
                johnPerson, Set.of(Role.EXTERNAL), null, List.of(), null));
    }

    private UUID bookWithOrder() throws Exception {
        UUID booking = book();
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, null));
        mockMvc.perform(post("/api/payments/paypal/orders").with(csrf()).with(user(userDetails.loadUserByUsername(
                        "roe.john"))).contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + booking + "\"}")).andExpect(status().isOk());
        return booking;
    }

    private UUID bookWithOrderQuietly() {
        try {
            return bookWithOrder();
        } catch (Exception failed) {
            throw new IllegalStateException(failed);
        }
    }

    private void timeOutTheCapture(UUID booking) throws Exception {
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.replyAfter(CAPTURE, 201, order("COMPLETED", booking, capture("COMPLETED", "15.00")),
                Duration.ofSeconds(2));
        captureRequest().andExpect(jsonPath("$.outcome").value("PROCESSING"));
    }

    private ResultActions captureRequest() throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders/{orderId}/capture", ORDER).with(csrf())
                .with(user(userDetails.loadUserByUsername("roe.john"))));
    }

    private ResultActions cancel() throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders/{orderId}/cancel", ORDER).with(csrf())
                .with(user(userDetails.loadUserByUsername("roe.john"))));
    }

    private ResultActions saveSettings(String clientId, String environment, boolean enabled, String secret)
            throws Exception {
        String body = "{\"clientId\":\"%s\",\"environment\":\"%s\",\"enabled\":%s%s}".formatted(clientId, environment,
                enabled, secret == null ? "" : ",\"secret\":\"" + secret + "\"");
        return mockMvc.perform(put("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("miles.richard")))
                .with(csrf()).sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli())
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private String captureOutcome() {
        try {
            String body = captureRequest().andReturn().getResponse().getContentAsString();
            return JSON.readTree(body).path("outcome").asString();
        } catch (Exception failed) {
            throw new IllegalStateException(failed);
        }
    }

    private static void awaitRequest(String route) throws InterruptedException {
        for (int attempt = 0; attempt < 200 && PAYPAL.seen(route).isEmpty(); attempt++) {
            Thread.sleep(10);
        }
        assertThat(PAYPAL.seen(route)).as("the capture reached PayPal").isNotEmpty();
    }

    private void age(Duration by) {
        jdbc.sql("""
                        UPDATE paypal_order SET created_at = created_at - CAST(:by AS interval),
                                                updated_at = updated_at - CAST(:by AS interval)
                        """)
                .param("by", by.toSeconds() + " seconds").update();
    }

    private void expire(UUID booking) {
        expire(booking, Duration.ofSeconds(1));
    }

    private void expire(UUID booking, Duration ago) {
        jdbc.sql("UPDATE booking SET payment_expires_at = :at WHERE id = :id")
                .param("at", Timestamp.from(clock.instant().minus(ago))).param("id", booking).update();
    }

    private void storeAttemptedOrder(String orderId, String currency) {
        jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, capture_attempted_at, approve_url, created_at, updated_at)
                        VALUES (:order, gen_random_uuid(), :account, 'SANDBOX', 1500, :currency, 'CREATED', :old,
                                'https://paypal.example.org/checkoutnow', :old, :old)
                        """)
                .param("order", orderId).param("account", johnAccount).param("currency", currency)
                .param("old", Timestamp.from(clock.instant().minus(Duration.ofHours(1)))).update();
    }

    private UUID pendingRefund(int status, String answer) throws Exception {
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, capture("COMPLETED", "15.00")));
        assertThat(captureOutcome()).isEqualTo("CONFIRMED");
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));
        PAYPAL.reply(REFUND, status, answer);
        mockMvc.perform(post("/api/treasury/paypal/refunds").with(csrf())
                        .with(user(userDetails.loadUserByUsername("miles.richard")))
                        .sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"orderId\":\"" + ORDER + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(credit.balance(johnAccount)).as("the refund took the credit").isZero();
        jdbc.sql("""
                        UPDATE paypal_refund SET requested_at = requested_at - interval '6 minutes',
                                                 updated_at = updated_at - interval '6 minutes'
                        """).update();
        return booking;
    }

    private UUID storePendingRefund(String orderId, String currency, int minutesUnchecked) {
        jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, capture_id, approve_url, created_at, updated_at)
                        VALUES (:order, gen_random_uuid(), :account, 'SANDBOX', 1500, 'EUR', 'CAPTURED', :capture,
                                'https://paypal.example.org/checkoutnow', :old, :old)
                        """)
                .param("order", orderId).param("account", johnAccount).param("capture", "CAPTURE-" + orderId)
                .param("old", Timestamp.from(clock.instant().minus(Duration.ofHours(1)))).update();
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO paypal_refund (id, order_id, account_id, amount_minor, currency, status, refund_id,
                                                   requested_by, requested_at, updated_at)
                        VALUES (:id, :order, :account, 1500, :currency, 'PENDING', :refund, :by, :requested,
                                :checked)
                        """)
                .param("id", id).param("order", orderId).param("account", johnAccount).param("currency", currency)
                .param("refund", "REFUND-" + orderId).param("by", adminAccount)
                .param("requested", Timestamp.from(clock.instant().minus(Duration.ofHours(1))))
                .param("checked", Timestamp.from(clock.instant().minus(Duration.ofMinutes(10 - minutesUnchecked))))
                .update();
        return id;
    }

    private static String refundReadOf(String orderId) {
        return "GET /sandbox/v2/payments/refunds/REFUND-" + orderId;
    }

    private Instant refundUpdatedAt(UUID refund) {
        return jdbc.sql("SELECT updated_at FROM paypal_refund WHERE id = :id").param("id", refund)
                .query(Timestamp.class).single().toInstant();
    }

    private Map<String, Object> refundRow() {
        return jdbc.sql("SELECT id, status, refund_id, failure_reason FROM paypal_refund WHERE order_id = :order")
                .param("order", ORDER).query().singleRow();
    }

    private static String readOf(String orderId) {
        return "GET /sandbox/v2/checkout/orders/" + orderId;
    }

    private boolean captureAttempted() {
        return jdbc.sql("SELECT capture_attempted_at IS NOT NULL FROM paypal_order").query(Boolean.class).single();
    }

    private String orderStatus() {
        return jdbc.sql("SELECT status FROM paypal_order").query(String.class).single();
    }

    private String bookingStatus(UUID booking) {
        return jdbc.sql("SELECT status FROM booking WHERE id = :id").param("id", booking).query(String.class).single();
    }

    private String cancellationReason(UUID booking) {
        return jdbc.sql("SELECT cancellation_reason FROM booking WHERE id = :id").param("id", booking)
                .query(String.class).single();
    }

    private String allocationStatus(UUID booking) {
        return jdbc.sql("SELECT status FROM court_allocation WHERE booking_id = :id").param("id", booking)
                .query(String.class).single();
    }

    private List<Map<String, Object>> entries(UUID booking) {
        return jdbc.sql("SELECT kind, amount_minor FROM credit_entry WHERE booking_id = :booking")
                .param("booking", booking).query().listOfRows();
    }

    private List<JsonNode> audit(String type, UUID booking) {
        return jdbc.sql("SELECT payload FROM domain_event WHERE event_type = :type AND subject_id = :id")
                .param("type", type).param("id", booking).query(String.class).list().stream()
                .map(JSON::readTree).toList();
    }

    private static String order(String status, UUID booking, String capture) {
        return FakePayPal.order(status, booking, "15.00", capture);
    }
}
