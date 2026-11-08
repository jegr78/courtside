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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
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
        "courtside.payment.paypal.request-timeout=3s"})
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class, PaymentTestFixture.class})
class PayPalReconciliationTest extends AbstractIntegrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String LIVE_READ = "GET /live/v2/checkout/orders/" + ORDER;
    private static final String UNAVAILABLE = "{\"name\":\"SERVICE_UNAVAILABLE\",\"message\":\"down\"}";
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
        assertThat(audit("payment.paypal.rejected", booking)).isEmpty();
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
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("HOLD_EXPIRED"));
        assertThat(audit("booking.payment.expired", booking)).hasSize(1);
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
        assertThat(audit("payment.paypal.rejected", booking)).isEmpty();
    }

    @Test
    void givenAnApprovedOrderPastTheDeadline_whenTheJobRuns_thenItIsVoidedWithoutACapture() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("nothing is captured once the hold has ended").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("HOLD_EXPIRED"));
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
        assertThat(PAYPAL.seen(READ)).as("PayPal is asked before the order is voided").hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement().satisfies(payload ->
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
        assertThat(PAYPAL.seen(READ)).as("the removed credentials still read the order once").hasSize(1);
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement().satisfies(payload ->
                assertThat(payload.get("reason").asString()).isEqualTo("CREDENTIALS_CHANGED"));
    }

    @Test
    void givenAnOpenOrderAndPayPalDown_whenPayPalIsSwitchedOff_thenTheJobVoidsItOncePayPalAnswers() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 503, UNAVAILABLE);
        saveSettings("client-sandbox", "SANDBOX", false, null).andExpect(status().isOk());
        assertThat(orderStatus()).as("an order PayPal cannot show is not voided").isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        age(Duration.ofMinutes(6));
        PAYPAL.replaceReply(READ, 200, order("APPROVED", booking, null));

        // when
        reconciliation.run();

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("switched off, PayPal captures nothing more").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement().satisfies(payload ->
                assertThat(payload.get("reason").asString()).isEqualTo("CREDENTIALS_CHANGED"));
    }

    @Test
    void givenAnOpenOrderWithACapture_whenTheEnvironmentChanges_thenItIsRecordedNotVoided() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, capture("COMPLETED", "15.00")));

        // when
        saveSettings("client-live", "LIVE", true, "paypal-secret-live").andExpect(status().isOk());

        // then
        assertThat(PAYPAL.seen(READ)).as("the order is read with the credentials it was created with").hasSize(1);
        assertThat(PAYPAL.seen(LIVE_READ)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(entries(booking)).containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(audit("payment.paypal.rejected", booking)).isEmpty();
    }

    @Test
    void givenACaptureRacingTheExpiry_whenBothRun_thenEitherConfirmedOrCreditedNeverBoth() throws Exception {
        // given
        UUID booking = bookWithOrder();
        age(Duration.ofMinutes(16));
        expire(booking);
        PAYPAL.reply(READ, 200, order("APPROVED", booking, null));
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
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
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
                Duration.ofSeconds(5));
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
        jdbc.sql("UPDATE booking SET payment_expires_at = :at WHERE id = :id")
                .param("at", Timestamp.from(clock.instant().minusSeconds(1))).param("id", booking).update();
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
