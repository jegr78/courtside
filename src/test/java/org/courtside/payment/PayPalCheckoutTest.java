package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.PendingPayments;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.internal.PayPalCheckout;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "courtside.payment.paypal.request-timeout=3s"})
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class, PaymentTestFixture.class})
class PayPalCheckoutTest extends AbstractIntegrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ORDER = FakePayPal.ORDER;
    private static final String APPROVE = FakePayPal.APPROVE;
    private static final String TOKEN = FakePayPal.TOKEN;
    private static final String CREATE = FakePayPal.CREATE;
    private static final String READ = FakePayPal.READ;
    private static final String CAPTURE = FakePayPal.CAPTURE;
    private static final String DECLINED = "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"declined\","
            + "\"details\":[{\"issue\":\"INSTRUMENT_DECLINED\"}]}";
    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");
    private static final FakePayPal PAYPAL = new FakePayPal();

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private BookingService bookingService;
    @Autowired
    private PendingPayments pendingPayments;
    @Autowired
    private PayPalCheckout checkout;
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

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID johnPerson;
    private UUID johnAccount;
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
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"), "doe.jane",
                Set.of(Role.EXTERNAL));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(winterHall, 1500);
        payment.storePayPalCredentials("SANDBOX", "client-sandbox", "paypal-secret-value");
    }

    @Test
    void givenAPendingBooking_whenTheOrderIsCreated_thenItCarriesTheServerAmountAndTheBookingId() throws Exception {
        // given
        UUID booking = book();
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));

        // when
        create("roe.john", booking)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value(ORDER))
                .andExpect(jsonPath("$.approveUrl").value(APPROVE));

        // then
        FakePayPal.Seen request = PAYPAL.only(CREATE);
        JsonNode unit = request.json().get("purchase_units").get(0);
        assertThat(unit.get("custom_id").asString()).as("PayPal carries the booking id back").isEqualTo(booking.toString());
        assertThat(unit.get("amount").get("value").asString()).isEqualTo("15.00");
        assertThat(unit.get("amount").get("currency_code").asString()).isEqualTo("EUR");
        JsonNode experience = request.json().get("payment_source").get("paypal").get("experience_context");
        assertThat(experience.get("return_url").asString()).isEqualTo("https://courts.example.org/payment/paypal/return");
        assertThat(experience.get("cancel_url").asString()).isEqualTo("https://courts.example.org/payment/paypal/cancel");
        assertThat(request.header("PayPal-Request-Id")).as("PayPal deduplicates a retried create")
                .isEqualTo(booking.toString());
        assertThat(order()).isEqualTo(Map.of("booking_id", booking, "account_id", johnAccount,
                "environment", "SANDBOX", "amount_minor", 1500, "currency", "EUR", "status", "CREATED"));
        assertThat(audit("payment.paypal.order.created", booking)).singleElement().satisfies(payload -> {
            assertThat(payload.get("orderId").asString()).isEqualTo(ORDER);
            assertThat(payload.get("amountMinor").asInt()).isEqualTo(1500);
            assertThat(payload.get("environment").asString()).isEqualTo("SANDBOX");
        });
    }

    @Test
    void givenAnOrderExists_whenCreatingAgain_thenTheSameApproveUrlComes() throws Exception {
        // given
        UUID booking = book();
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));
        create("roe.john", booking).andExpect(status().isOk());

        // when
        create("roe.john", booking)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value(ORDER))
                .andExpect(jsonPath("$.approveUrl").value(APPROVE));

        // then
        assertThat(PAYPAL.seen(CREATE)).as("one booking gets one PayPal order").hasSize(1);
        assertThat(audit("payment.paypal.order.created", booking)).hasSize(1);
    }

    @Test
    void givenThePriceChangedAfterBooking_whenTheOrderIsCreated_thenItCarriesTheStoredAmount() throws Exception {
        // given
        UUID booking = book();
        cards.priceForExternals(winterHall, 2500);
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));

        // when
        create("roe.john", booking).andExpect(status().isOk());

        // then
        JsonNode amount = PAYPAL.only(CREATE).json().get("purchase_units").get(0).get("amount");
        assertThat(amount.get("value").asString()).as("the booking's stored amount, not today's price")
                .isEqualTo("15.00");
    }

    @Test
    void givenARequestNamingAnAmount_whenTheOrderIsCreated_thenItIsRefusedAndNothingReachesPayPal() throws Exception {
        // given
        UUID booking = book();

        // when
        mockMvc.perform(post("/api/payments/paypal/orders").with(csrf()).with(user(account("roe.john")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bookingId\":\"" + booking + "\",\"amountMinor\":1}"))

                // then
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"));
        assertThat(PAYPAL.seen(CREATE)).isEmpty();
    }

    @Test
    void givenAnApprovedOrder_whenTheBookerReturns_thenTheBookingIsConfirmedWithTwoLedgerEntries() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        capture("roe.john")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId").value(booking.toString()))
                .andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(entries(booking)).as("the payment and the debit leave the balance unchanged")
                .containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                        Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(orderStatus()).isEqualTo("CAPTURED");
        assertThat(jdbc.sql("SELECT capture_id FROM paypal_order").query(String.class).single()).isEqualTo("CAPTURE1");
        assertThat(audit("payment.paypal.captured", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("captureId").asString()).isEqualTo("CAPTURE1"));
        assertThat(audit("booking.booking.confirmed", booking)).hasSize(1);
    }

    @Test
    void givenAnOrderVoidedWhileTheReturnReads_whenItWouldCapture_thenPayPalIsNotAskedToCapture() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.onNext(READ, () -> jdbc.sql("UPDATE paypal_order SET status = 'VOIDED'").update());

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("a voided order is never captured").isEmpty();
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(jdbc.sql("SELECT capture_attempted_at IS NULL FROM paypal_order").query(Boolean.class).single())
                .as("no attempt is stamped on a voided order").isTrue();
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenTwoConcurrentReturns_whenBothCapture_thenOneConfirmationAndOnePayPalPayment() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));
        PAYPAL.holdUntilBothArrive(CAPTURE);

        // when
        CompletableFuture<String> first = CompletableFuture.supplyAsync(this::captureOutcome);
        CompletableFuture<String> second = CompletableFuture.supplyAsync(this::captureOutcome);

        // then
        assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS)))
                .as("both returns show the confirmed booking").containsExactly("CONFIRMED", "CONFIRMED");
        assertThat(PAYPAL.seen(CAPTURE)).as("both returns did reach PayPal at once").hasSize(2);
        assertThat(entries(booking)).as("one PayPal payment for one order")
                .containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                        Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(audit("booking.booking.confirmed", booking)).hasSize(1);
        assertThat(audit("payment.paypal.captured", booking)).hasSize(1);
    }

    @Test
    void givenACaptureInFlight_whenASecondReturnIsAnsweredAsADuplicate_thenItWaitsAndTheFirstConfirms()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));
        PAYPAL.reply(CAPTURE, 409, "{\"name\":\"RESOURCE_CONFLICT\",\"message\":\"x\","
                + "\"details\":[{\"issue\":\"PREVIOUS_REQUEST_IN_PROGRESS\"}]}");
        CountDownLatch firstCapture = PAYPAL.holdFirst(CAPTURE);
        CompletableFuture<String> first = CompletableFuture.supplyAsync(this::captureOutcome);
        awaitRequest(CAPTURE);

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(bookingStatus(booking)).as("a duplicate answer never releases the court").isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        firstCapture.countDown();
        assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo("CONFIRMED");
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(entries(booking)).hasSize(2);
    }

    @Test
    void givenAMismatchedAmount_whenCapturing_thenNothingIsCapturedAndTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "1.00", null));

        // when
        capture("roe.john")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(PAYPAL.seen(CAPTURE)).as("no money moves on a mismatch").isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).as("the court is free").isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("REJECTED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("AMOUNT_MISMATCH"));
    }

    @Test
    void givenAnotherBookingsOrder_whenCapturing_thenItIsRejectedBeforeAnyCapture() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", UUID.randomUUID(), "15.00", null));

        // when
        capture("roe.john").andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(PAYPAL.seen(CAPTURE)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("BOOKING_MISMATCH"));
    }

    @Test
    void givenACaptureOfAnotherAmount_whenCapturing_thenTheBookingIsReleasedAndTheCaptureBecomesCredit()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "14.00")));

        // when
        capture("roe.john").andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));

        // then
        assertThat(bookingStatus(booking)).as("a booking is confirmed only for its own amount").isEqualTo("CANCELLED");
        assertThat(entries(booking)).as("the money is never neither a booking nor credit")
                .containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1400));
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
    }

    @Test
    void givenAnOrderCompletedForAnotherAmount_whenCapturing_thenTheCapturedMoneyBecomesCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, "14.00", capture("COMPLETED", "14.00")));

        // when
        capture("roe.john").andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(entries(booking)).as("money PayPal already moved is never refused into nothing")
                .containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1400));
        assertThat(audit("payment.paypal.rejected", booking)).isEmpty();
    }

    @Test
    void givenACaptureOfNothing_whenCapturing_thenTheOrderIsRecordedWithoutCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "0.00")));

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));

        // then
        assertThat(entries(booking)).as("a capture of nothing is no credit").isEmpty();
        assertThat(orderStatus()).as("the capture is still recorded").isEqualTo("LATE_CAPTURED");
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
    }

    @Test
    void givenAReleasedBooking_whenItsOrderIsCaptured_thenTheAmountBecomesCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        assertThat(pendingPayments.release(booking)).isTrue();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        capture("roe.john").andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(entries(booking)).containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(audit("payment.paypal.lateCapture", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("credited").asBoolean()).isTrue());
        assertThat(audit("booking.booking.confirmed", booking)).isEmpty();
    }

    @Test
    void givenAnAnonymisedBooker_whenALateCaptureArrives_thenTheOrderIsRecordedWithoutCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        assertThat(pendingPayments.release(booking)).isTrue();
        jdbc.sql("UPDATE user_account SET anonymised_at = now(), enabled = false, password_hash = NULL WHERE id = :id")
                .param("id", johnAccount).update();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        PayPalCheckout.Settlement settlement = checkout.settle(ORDER);

        // then
        assertThat(settlement.outcome()).isEqualTo(PayPalCheckout.Outcome.LATE_CREDITED);
        assertThat(entries(booking)).as("an anonymised account receives no credit").isEmpty();
        assertThat(orderStatus()).as("the captured order stays on record for the treasurer").isEqualTo("LATE_CAPTURED");
        assertThat(audit("payment.paypal.lateCapture", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("credited").asBoolean()).isFalse());
    }

    @Test
    void givenABookingConfirmedWithoutItsOrder_whenTheCaptureArrives_thenTheIdsAreLoggedAndNothingIsRecorded(
            CapturedOutput output) throws Exception {
        // given
        UUID booking = bookWithOrder();
        jdbc.sql("UPDATE booking SET status = 'CONFIRMED' WHERE id = :id").param("id", booking).update();
        jdbc.sql("UPDATE court_allocation SET status = 'CONFIRMED' WHERE booking_id = :id").param("id", booking)
                .update();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when / then
        assertThatThrownBy(() -> checkout.settle(ORDER)).isInstanceOf(IllegalStateException.class);
        assertThat(output.getOut()).as("the treasurer can find the captured money by its ids")
                .contains("PayPal order " + ORDER).contains("capture CAPTURE1");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenTheJobAlreadyConfirmed_whenThePlayerReturns_thenTheReturnShowsTheConfirmedBooking() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));
        assertThat(checkout.settle(ORDER).outcome()).isEqualTo(PayPalCheckout.Outcome.CONFIRMED);
        int calls = PAYPAL.all().size();

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // then
        assertThat(PAYPAL.all()).as("a settled order is answered from what is stored").hasSize(calls);
        assertThat(entries(booking)).hasSize(2);
    }

    @Test
    void givenAnOrderAlreadyCompletedAtPayPal_whenCapturing_thenItIsConfirmedWithoutASecondCapture() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        capture("roe.john").andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // then
        assertThat(PAYPAL.seen(CAPTURE)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
    }

    @Test
    void givenARefusedCaptureAndAnOrderWithoutCapture_whenCapturing_thenItIsRejectedAndTheCourtIsFree()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 422, DECLINED);

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(PAYPAL.seen(READ)).as("the order is read again after the refusal").hasSize(2);
        assertThat(cancellationReason(booking)).as("no money moved, so the hold ends at once")
                .isEqualTo("PAYMENT_EXPIRED");
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("REJECTED");
        assertThat(entries(booking)).isEmpty();
        assertThat(audit("payment.paypal.rejected", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("CAPTURE_REFUSED"));
    }

    @Test
    void givenARefusedCaptureAndACompletedOrderWithoutCapture_whenCapturing_thenTheCourtStaysHeld() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(READ, 200, order("COMPLETED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 422, DECLINED);

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(bookingStatus(booking)).as("money may have moved, so reconciliation decides")
                .isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenARefusedCaptureAndAnUnreadableOrder_whenCapturing_thenTheCourtStaysHeldAndTheOutcomeIsProcessing()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(READ, 503, "{}");
        PAYPAL.reply(CAPTURE, 422, DECLINED);

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(PAYPAL.seen(READ)).hasSize(2);
        assertThat(bookingStatus(booking)).as("an unknown outcome keeps the court held").isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"DECLINED", "FAILED"})
    void givenACaptureThatDidNotGoThrough_whenCapturing_thenItIsRejectedAndTheCourtIsFree(String captureStatus)
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture(captureStatus, "15.00")));

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("REJECTED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenAPendingCapture_whenCapturing_thenTheCourtStaysHeld() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("PENDING", "15.00")));

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(bookingStatus(booking)).as("PayPal has not settled the money yet").isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenACaptureInAFormerClubCurrency_whenCapturing_thenItIsRecordedWithoutCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        assertThat(pendingPayments.release(booking)).isTrue();
        config.chargeIn("CHF");
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).as("the capture stays on record for the treasurer").isEqualTo("LATE_CAPTURED");
        assertThat(entries(booking)).as("credit is kept in the club currency only").isEmpty();
        assertThat(audit("payment.paypal.lateCapture", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("credited").asBoolean()).isFalse());
    }

    @Test
    void givenACancelWhileACaptureIsInFlight_whenTheCaptureCompletes_thenItBecomesCredit() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));
        CountDownLatch inFlight = PAYPAL.holdFirst(CAPTURE);
        CompletableFuture<String> returned = CompletableFuture.supplyAsync(this::captureOutcome);
        awaitRequest(CAPTURE);
        cancel("roe.john").andExpect(jsonPath("$.outcome").value("REJECTED"));
        assertThat(orderStatus()).isEqualTo("VOIDED");

        // when
        inFlight.countDown();

        // then
        assertThat(returned.get(10, TimeUnit.SECONDS)).isEqualTo("LATE_CREDITED");
        assertThat(orderStatus()).isEqualTo("LATE_CAPTURED");
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(entries(booking)).as("the money is credit, never lost")
                .containsExactly(Map.of("kind", "PAYPAL_LATE_CAPTURE", "amount_minor", 1500));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenACaptureTimeout_whenCapturing_thenTheOrderStaysOpenAndTheOutcomeIsProcessing() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.replyAfter(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")),
                Duration.ofSeconds(5));

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(orderStatus()).as("the outcome is unknown, so the order is left for reconciliation")
                .isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).as("the court stays held").isEqualTo("PENDING_PAYMENT");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenAnOrderOfTheOtherEnvironment_whenCapturing_thenItIsNotCapturedWithTheCurrentCredentials()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        payment.switchPayPalEnvironment("LIVE");

        // when
        capture("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(PAYPAL.all()).extracting(FakePayPal.Seen::route)
                .as("a sandbox order is never sent with live credentials")
                .noneMatch(route -> route.startsWith("POST /live") || route.startsWith("GET /live"))
                .doesNotContain(READ, CAPTURE);
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
    }

    @Test
    void givenAnotherAccount_whenCapturingOrCancelling_thenTheOrderIsNotFound() throws Exception {
        // given
        UUID booking = bookWithOrder();

        // when
        ResultActions capture = capture("doe.jane");
        ResultActions cancel = cancel("doe.jane");
        ResultActions create = create("doe.jane", booking);

        // then
        for (ResultActions answer : List.of(capture, cancel, create)) {
            answer.andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:paypal-order-not-found"));
        }
        assertThat(PAYPAL.seen(READ)).isEmpty();
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(orderStatus()).isEqualTo("CREATED");
    }

    @Test
    void givenNoSession_whenCreatingAnOrder_thenItIsUnauthenticated() throws Exception {
        // when
        mockMvc.perform(post("/api/payments/paypal/orders").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bookingId\":\"" + UUID.randomUUID() + "\"}"))

                // then
                .andExpect(status().isUnauthorized());
        assertThat(PAYPAL.all()).isEmpty();
    }

    @Test
    void givenAnAbandonedPayment_whenCancelled_thenTheCourtIsFreeAtOnce() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(cancellationReason(booking)).isEqualTo("PAYMENT_EXPIRED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(audit("payment.paypal.voided", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("reason").asString()).isEqualTo("ABANDONED"));
        assertThat(audit("payment.paypal.rejected", booking)).as("giving up is not a refusal").isEmpty();
        int reads = PAYPAL.seen(READ).size();
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));
        assertThat(audit("booking.payment.expired", booking)).as("a second cancel changes nothing").hasSize(1);
        capture("roe.john").andExpect(jsonPath("$.outcome").value("REJECTED"));
        assertThat(PAYPAL.seen(READ)).as("a voided order is never read or captured again").hasSize(reads);
        assertThat(PAYPAL.seen(CAPTURE)).isEmpty();
    }

    @Test
    void givenAnApprovedOrderWithoutCapture_whenCancelled_thenItIsVoidedAndTheCourtIsFree() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("REJECTED"));

        // then
        assertThat(orderStatus()).isEqualTo("VOIDED");
        assertThat(bookingStatus(booking)).isEqualTo("CANCELLED");
        assertThat(allocationStatus(booking)).isEqualTo("CANCELLED");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenACaptureTimeoutAndPayPalShowingTheCapture_whenCancelled_thenTheBookingIsConfirmedNotVoided()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // then
        assertThat(orderStatus()).as("money PayPal took is never voided").isEqualTo("CAPTURED");
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(entries(booking)).containsExactlyInAnyOrder(Map.of("kind", "PAYPAL_PAYMENT", "amount_minor", 1500),
                Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
    }

    @Test
    void givenACaptureTimeoutAndACompletedOrderWithoutCapture_whenCancelled_thenTheCourtStaysHeld()
            throws Exception {
        // given
        UUID booking = bookWithOrder();
        timeOutTheCapture(booking);
        PAYPAL.replaceReply(READ, 200, order("COMPLETED", booking, "15.00", null));

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(orderStatus()).isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenAnUnreadableOrder_whenCancelled_thenTheCourtStaysHeld() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 503, "{}");

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("PROCESSING"));

        // then
        assertThat(orderStatus()).as("an unknown state is never voided").isEqualTo("CREATED");
        assertThat(bookingStatus(booking)).isEqualTo("PENDING_PAYMENT");
        assertThat(entries(booking)).isEmpty();
    }

    @Test
    void givenACapturedOrder_whenCancelled_thenNothingChanges() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")));
        capture("roe.john").andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // when
        cancel("roe.john").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("CONFIRMED"));

        // then
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
        assertThat(orderStatus()).isEqualTo("CAPTURED");
    }

    @Test
    void givenPayPalSwitchedOnOrOff_whenTheBookerAsks_thenAvailabilitySaysSo() throws Exception {
        // when
        mockMvc.perform(get("/api/payments/paypal/availability").with(user(account("roe.john"))))

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true));
        jdbc.sql("UPDATE paypal_settings SET enabled = false").update();
        mockMvc.perform(get("/api/payments/paypal/availability").with(user(account("roe.john"))))
                .andExpect(jsonPath("$.available").value(false));
    }

    private UUID book() {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall,
                new TimeSlot(TOMORROW_AFTERNOON, TOMORROW_AFTERNOON.plus(Duration.ofHours(1))), johnAccount,
                johnPerson, Set.of(Role.EXTERNAL), null, List.of(), null));
    }

    private UUID bookWithOrder() throws Exception {
        UUID booking = book();
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));
        create("roe.john", booking).andExpect(status().isOk());
        return booking;
    }

    private void timeOutTheCapture(UUID booking) throws Exception {
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.replyAfter(CAPTURE, 201, order("COMPLETED", booking, "15.00", capture("COMPLETED", "15.00")),
                Duration.ofSeconds(5));
        capture("roe.john").andExpect(jsonPath("$.outcome").value("PROCESSING"));
    }

    private ResultActions create(String username, UUID booking) throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders").with(csrf()).with(user(account(username)))
                .contentType(MediaType.APPLICATION_JSON).content("{\"bookingId\":\"" + booking + "\"}"));
    }

    private ResultActions capture(String username) throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders/{orderId}/capture", ORDER).with(csrf())
                .with(user(account(username))));
    }

    private ResultActions cancel(String username) throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders/{orderId}/cancel", ORDER).with(csrf())
                .with(user(account(username))));
    }

    private String captureOutcome() {
        try {
            String body = capture("roe.john").andReturn().getResponse().getContentAsString();
            return JSON.readTree(body).path("outcome").asString();
        } catch (Exception failed) {
            throw new IllegalStateException(failed);
        }
    }

    private static void awaitRequest(String route) throws InterruptedException {
        for (int attempt = 0; attempt < 200 && PAYPAL.seen(route).isEmpty(); attempt++) {
            Thread.sleep(10);
        }
        assertThat(PAYPAL.seen(route)).as("the first capture reached PayPal").isNotEmpty();
    }

    private UserDetails account(String username) {
        return userDetails.loadUserByUsername(username);
    }

    private Map<String, Object> order() {
        return jdbc.sql("SELECT booking_id, account_id, environment, amount_minor, currency, status FROM paypal_order")
                .query().singleRow();
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

    private static String order(String status, UUID booking, String value, String capture) {
        return FakePayPal.order(status, booking, value, capture);
    }

    private static String capture(String status, String value) {
        return FakePayPal.capture(status, value);
    }
}
