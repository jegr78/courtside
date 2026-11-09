package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.internal.PayPalRefunds;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Two admission slots and a larger pool let two treasurers' returns meet at the order's row lock.
@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "courtside.payment.paypal.request-timeout=3s", "courtside.admission.classes[payment-provider-check].cost=5",
        "courtside.admission.classes[payment-provider-check].concurrency=2",
        "spring.datasource.hikari.maximum-pool-size=6"})
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class, PaymentTestFixture.class})
class PayPalRefundTest extends AbstractIntegrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ORDER = FakePayPal.ORDER;
    private static final String TOKEN = FakePayPal.TOKEN;
    private static final String CREATE = FakePayPal.CREATE;
    private static final String READ = FakePayPal.READ;
    private static final String CAPTURE = FakePayPal.CAPTURE;
    private static final String REFUND = FakePayPal.REFUND;
    private static final String REFUSED = "urn:courtside:error:paypal-refund-refused";
    private static final String UNAVAILABLE = "urn:courtside:error:paypal-refund-unavailable";
    private static final String FULLY_REFUNDED = "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"refunded\","
            + "\"details\":[{\"issue\":\"CAPTURE_FULLY_REFUNDED\"}]}";
    private static final String REFUND_REFUSED = "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"Refund refused\","
            + "\"details\":[{\"issue\":\"REFUND_NOT_ALLOWED\"}]}";
    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");
    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(4);
    private static final ExecutorService THREADS = Executors.newCachedThreadPool();
    private static final FakePayPal PAYPAL = new FakePayPal();

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private BookingService bookingService;
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
    private TransactionTemplate transactions;
    @Autowired
    private PayPalRefunds payPalRefunds;
    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID johnPerson;
    private UUID johnAccount;
    private UUID richardAccount;
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
        THREADS.close();
    }

    @BeforeEach
    void setUp() {
        PAYPAL.reset();
        PAYPAL.reply(TOKEN, 200, "{\"access_token\":\"token-1\",\"expires_in\":3600}");
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        johnPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(johnPerson, "roe.john", Set.of(Role.EXTERNAL));
        richardAccount = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles", "richard.miles@example.org"), "miles.richard",
                Set.of(Role.MEMBER, Role.TREASURER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.MEMBER));
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"), "doe.jane",
                Set.of(Role.MEMBER, Role.TREASURER));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(winterHall, 1500);
        payment.storePayPalCredentials("SANDBOX", "client-sandbox", "paypal-secret-value");
    }

    @Test
    void givenACaptureRefundedInPartAtPayPal_whenPayPalCompletesOnlyTheRest_thenTheRefundStaysPendingWithItsCreditTaken()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED", "5.00"));

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(refundRow()).as("a refund of less than the payment is not the return Courtside took credit for")
                .containsEntry("status", "PENDING").containsEntry("refund_id", "REFUND1");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(audit("payment.paypal.refunded", booking)).as("nothing claims the payment went back").isEmpty();
    }

    @Test
    void givenACancelledPayPalBooking_whenTheTreasurerReturnsIt_thenPayPalRefundsAndTheBalanceDropsByTheAmount()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED", "15.00"));

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value(ORDER))
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.failureReason").doesNotExist());
        FakePayPal.Seen request = PAYPAL.only(REFUND);
        assertThat(request.body()).as("an empty body refunds the whole capture").isEqualTo("{}");
        assertThat(request.header("PayPal-Request-Id")).as("a retried refund cannot refund twice")
                .isEqualTo(refundRow().get("id").toString());
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(entries(booking)).contains(Map.of("kind", "PAYPAL_REFUND", "amount_minor", -1500))
                .noneMatch(entry -> entry.get("kind").equals("PAYPAL_REFUND_REVERSED"));
        assertThat(refundRow()).containsAllEntriesOf(Map.of("account_id", johnAccount, "amount_minor", 1500,
                "currency", "EUR", "status", "COMPLETED", "refund_id", "REFUND1", "requested_by", richardAccount));
        assertThat(refundRow().get("failure_reason")).isNull();
        assertThat(audit("payment.paypal.refund.requested", booking)).singleElement().satisfies(payload -> {
            assertThat(payload.get("orderId").asString()).isEqualTo(ORDER);
            assertThat(payload.get("amountMinor").asInt()).isEqualTo(1500);
            assertThat(payload.get("environment").asString()).isEqualTo("SANDBOX");
        });
        assertThat(audit("payment.paypal.refunded", booking)).singleElement().satisfies(payload -> {
            assertThat(payload.get("refundId").asString()).isEqualTo("REFUND1");
            assertThat(payload.get("accountId").asString()).isEqualTo(johnAccount.toString());
            assertThat(payload.get("amountMinor").asInt()).isEqualTo(1500);
            assertThat(payload.get("anonymised").asBoolean()).isFalse();
            assertThat(payload.get("environment").asString()).isEqualTo("SANDBOX");
        });
        assertThat(audit("payment.paypal.refundFailed", booking)).isEmpty();
    }

    @Test
    void givenAReturnedPayment_whenReturnedAgain_thenItIsRefusedAsAlreadyRefunded() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED"));
        refund("miles.richard", ORDER, true).andExpect(jsonPath("$.status").value("COMPLETED"));

        // when
        refused(refund("miles.richard", ORDER, true), REFUSED, "payment.paypal.refund.alreadyRefunded");

        // then
        assertThat(PAYPAL.seen(REFUND)).as("one PayPal refund per payment").hasSize(1);
        assertThat(kinds(booking, "PAYPAL_REFUND")).isEqualTo(1);
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(audit("payment.paypal.refund.requested", booking)).hasSize(1);
    }

    @Test
    void givenSpentCredit_whenReturning_thenItIsRefusedAsCreditSpentWithTheBalance() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        credit.payOut(johnAccount, 500);

        // when
        refused(refund("miles.richard", ORDER, true), REFUSED, "payment.paypal.refund.creditSpent")

                // then
                .andExpect(jsonPath("$.violations[0].params.amountMinor").value(1500))
                .andExpect(jsonPath("$.violations[0].params.balanceMinor").value(1000))
                .andExpect(jsonPath("$.violations[0].params.currency").value("EUR"));
        assertThat(PAYPAL.seen(REFUND)).isEmpty();
        assertThat(kinds(booking, "PAYPAL_REFUND")).isZero();
        assertThat(refunds()).isZero();
        assertThat(credit.balance(johnAccount)).isEqualTo(1000);
        assertThat(audit("payment.paypal.refund.requested", booking)).isEmpty();
    }

    @Test
    void givenAConfirmedBooking_whenReturning_thenItIsNotRefundable() throws Exception {
        // given
        UUID booking = paid();

        // when
        refused(refund("miles.richard", ORDER, true), REFUSED, "payment.paypal.refund.notRefundable");
        refused(refund("miles.richard", "UNKNOWN1", true), REFUSED, "payment.paypal.refund.notRefundable");

        // then
        assertThat(PAYPAL.seen(REFUND)).isEmpty();
        assertThat(refunds()).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND")).isZero();
        assertThat(bookingStatus(booking)).isEqualTo("CONFIRMED");
    }

    @Test
    void givenALateCapture_whenReturning_thenTheCapturedAmountGoesBack() throws Exception {
        // given
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", FakePayPal.capture("COMPLETED", "14.00")));
        capture().andExpect(jsonPath("$.outcome").value("LATE_CREDITED"));
        assertThat(credit.balance(johnAccount)).isEqualTo(1400);
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED"));

        // when
        refund("miles.richard", ORDER, true).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        // then
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(entries(booking)).contains(Map.of("kind", "PAYPAL_REFUND", "amount_minor", -1400));
        assertThat(refundRow()).containsEntry("amount_minor", 1400).containsEntry("status", "COMPLETED");
        assertThat(audit("payment.paypal.refunded", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("amountMinor").asInt()).isEqualTo(1400));
    }

    @Test
    void givenARefusedRefund_whenReturning_thenTheCreditIsRestoredAndTheReasonShown() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, "{\"name\":\"UNPROCESSABLE_ENTITY\",\"message\":\"Refund refused\","
                + "\"details\":[{\"issue\":\"REFUND_NOT_ALLOWED\"}]}");

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureReason").value("UNPROCESSABLE_ENTITY: Refund refused"));
        assertThat(credit.balance(johnAccount)).as("a clear refusal gives the credit back").isEqualTo(1500);
        assertThat(entries(booking)).contains(Map.of("kind", "PAYPAL_REFUND", "amount_minor", -1500),
                Map.of("kind", "PAYPAL_REFUND_REVERSED", "amount_minor", 1500));
        assertThat(refundRow()).containsEntry("status", "FAILED")
                .containsEntry("failure_reason", "UNPROCESSABLE_ENTITY: Refund refused");
        assertThat(audit("payment.paypal.refundFailed", booking)).singleElement().satisfies(payload -> {
            assertThat(payload.get("reason").asString()).isEqualTo("UNPROCESSABLE_ENTITY: Refund refused");
            assertThat(payload.get("amountMinor").asInt()).isEqualTo(1500);
        });
        assertThat(audit("payment.paypal.refunded", booking)).isEmpty();
        refused(refund("miles.richard", ORDER, true), REFUSED, "payment.paypal.refund.alreadyRefunded");
        assertThat(PAYPAL.seen(REFUND)).as("a failed refund is final").hasSize(1);
    }

    @Test
    void givenARefusedRefundWhileTheOrderListsAPendingFullRefund_whenReturning_thenThatRefundIsFollowed()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, REFUND_REFUSED);
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "PENDING", "15.00"));

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(refundRow()).as("a refund PayPal already holds keeps the credit taken")
                .containsEntry("status", "PENDING").containsEntry("refund_id", "REFUND7");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
        assertThat(audit("payment.paypal.refundFailed", booking)).isEmpty();
    }

    @Test
    void givenARefusedRefundAndAnUnreadableOrder_whenReturning_thenTheRefundIsPendingAndTheCreditStaysTaken()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, REFUND_REFUSED);
        PAYPAL.replaceReply(READ, 503, "{}");

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(refundRow()).containsEntry("status", "PENDING");
        assertThat(credit.balance(johnAccount)).as("a refusal is only trusted once the order shows no refund")
                .isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
        assertThat(audit("payment.paypal.refundFailed", booking)).isEmpty();
    }

    @Test
    void givenARefusedRefundWhileTheOrderListsOnlyAFailedFullRefund_whenReturning_thenTheCreditIsRestored()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, REFUND_REFUSED);
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "FAILED", "15.00"));
        int readsBefore = PAYPAL.seen(READ).size();

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"));
        assertThat(PAYPAL.seen(READ)).as("the order was read before the credit went back").hasSize(readsBefore + 1);
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isEqualTo(1);
        assertThat(refundRow().get("refund_id")).as("a failed listed refund is never adopted").isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"FAILED", "CANCELLED"})
    void givenARefundPayPalReportsFailed_whenReturning_thenTheCreditIsRestored(String payPalStatus) throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund(payPalStatus));

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureReason").value("PayPal reports the refund as " + payPalStatus));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isEqualTo(1);
        assertThat(refundRow()).containsEntry("status", "FAILED").containsEntry("refund_id", "REFUND1");
        assertThat(audit("payment.paypal.refundFailed", booking)).hasSize(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"delayed past the timeout", "2xx without id", "500", "429", "409"})
    void givenNoAnswerOrAnUnreadableAnswer_whenReturning_thenTheRefundIsPendingAndTheCreditStaysTaken(String answer)
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        switch (answer) {
            case "delayed past the timeout" -> PAYPAL.replyAfter(REFUND, 201, FakePayPal.refund("COMPLETED"),
                    Duration.ofSeconds(5));
            case "2xx without id" -> PAYPAL.reply(REFUND, 201, "{\"status\":\"COMPLETED\"}");
            default -> PAYPAL.reply(REFUND, Integer.parseInt(answer), "{}");
        }

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(credit.balance(johnAccount)).as("an unclear answer never restores credit (%s)", answer).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
        assertThat(refundRow()).containsEntry("status", "PENDING");
        assertThat(refundRow().get("refund_id")).isNull();
        assertThat(audit("payment.paypal.refunded", booking)).isEmpty();
        assertThat(audit("payment.paypal.refundFailed", booking)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"token refused", "refund answers 401 twice", "refund answers 403"})
    void givenARefusalThatIsNotTheRefundsOwn_whenReturning_thenTheRefundIsPendingAndTheCreditStaysTaken(String cause)
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        String denied = "{\"name\":\"NOT_AUTHORIZED\",\"message\":\"denied\"}";
        switch (cause) {
            case "token refused" -> {
                PAYPAL.reply(REFUND, 401, denied);
                PAYPAL.replaceReply(TOKEN, 401, "{\"error\":\"invalid_client\"}");
            }
            case "refund answers 401 twice" -> PAYPAL.reply(REFUND, 401, denied);
            default -> PAYPAL.reply(REFUND, 403, denied);
        }

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.failureReason").doesNotExist());
        assertThat(PAYPAL.seen(REFUND)).as("a 401 retries once with a new token")
                .hasSize(cause.equals("refund answers 401 twice") ? 2 : 1);
        assertThat(credit.balance(johnAccount)).as("%s never restores credit", cause).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
        assertThat(refundRow()).containsEntry("status", "PENDING");
        assertThat(audit("payment.paypal.refundFailed", booking)).isEmpty();
        assertThat(audit("payment.paypal.refunded", booking)).isEmpty();
    }

    @Test
    void givenAFailedRefundWithPayPalsReason_whenReturning_thenTheReasonIsShown() throws Exception {
        // given
        paidAndCancelled();
        PAYPAL.reply(REFUND, 201, "{\"id\":\"REFUND1\",\"status\":\"FAILED\","
                + "\"status_details\":{\"reason\":\"ECHECK\"}}");

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureReason").value("PayPal reports the refund as FAILED: ECHECK"));
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenARefundPayPalHoldsPending_whenReturning_thenItStaysPendingWithTheRefundId() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("PENDING"));

        // when
        refund("miles.richard", ORDER, true).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        // then
        assertThat(refundRow()).containsEntry("status", "PENDING").containsEntry("refund_id", "REFUND1");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
    }

    @Test
    void givenACaptureAlreadyRefundedInTheDashboard_whenReturning_thenItIsRecordedCompletedWithoutRestoringCredit()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, FULLY_REFUNDED);
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "COMPLETED", "15.00"));

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));
        assertThat(refundRow()).as("the refund PayPal lists on the order is the one recorded")
                .containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND7");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
        assertThat(audit("payment.paypal.refunded", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("refundId").asString()).isEqualTo("REFUND7"));
    }

    @ParameterizedTest(name = "{0} with an order read answering {1}")
    @CsvSource({"fully refunded, 503", "fully refunded, 404", "refused, 404"})
    void givenAnAnswerThatNeedsTheOrder_whenTheOrderCannotBeRead_thenTheRefundIsPendingAndTheCreditStaysTaken(
            String answer, int orderRead) throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, answer.equals("refused") ? REFUND_REFUSED : FULLY_REFUNDED);
        PAYPAL.replaceReply(READ, orderRead, "{}");

        // when
        refund("miles.richard", ORDER, true)

                // then
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(PAYPAL.seen(READ)).as("the order was asked for its refunds").isNotEmpty();
        assertThat(refundRow()).as("an unread order decides nothing").containsEntry("status", "PENDING");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
    }

    @Test
    void givenACaptureRefundedElsewhereWithoutACompletedRefund_whenReturning_thenItStaysPending() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, FULLY_REFUNDED);
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "PENDING", "15.00"));

        // when
        refund("miles.richard", ORDER, true).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        // then
        assertThat(PAYPAL.seen(READ)).as("the order was read for its refunds").isNotEmpty();
        assertThat(refundRow()).as("the pending refund PayPal lists is followed from now on")
                .containsEntry("status", "PENDING").containsEntry("refund_id", "REFUND7");
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
    }

    @Test
    void givenACaptureRefundedElsewhereOnlyInPart_whenReturning_thenItStaysPendingWithoutThePartialRefund()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 422, FULLY_REFUNDED);
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "COMPLETED", "5.00"));

        // when
        refund("miles.richard", ORDER, true).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        // then
        assertThat(refundRow()).as("a partial refund is not this payment's refund")
                .containsEntry("status", "PENDING");
        assertThat(refundRow().get("refund_id")).isNull();
        assertThat(audit("payment.paypal.refunded", booking)).isEmpty();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
    }

    @Test
    void givenAnUnansweredRefund_whenResolvedAndTheOrderListsItsPendingRefund_thenItIsFollowedWithoutASecondRequest()
            throws Exception {
        // given
        UUID booking = unansweredRefund();
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "PENDING", "15.00"));

        // when
        PayPalRefunds.Resolution resolution = payPalRefunds.resolve(refundId());

        // then
        assertThat(resolution.refund().status()).isEqualTo(PayPalRefunds.RefundStatus.PENDING);
        assertThat(refundRow()).containsEntry("status", "PENDING").containsEntry("refund_id", "REFUND7");
        assertThat(PAYPAL.seen(REFUND)).as("a refund PayPal already holds is never requested again").hasSize(1);
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND_REVERSED")).isZero();
    }

    @Test
    void givenAnUnansweredRefund_whenResolvedAndTheOrderListsItsCompletedRefund_thenItIsCompletedWithoutASecondRequest()
            throws Exception {
        // given
        UUID booking = unansweredRefund();
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "COMPLETED", "15.00"));

        // when
        PayPalRefunds.Resolution resolution = payPalRefunds.resolve(refundId());

        // then
        assertThat(resolution.refund().status()).isEqualTo(PayPalRefunds.RefundStatus.COMPLETED);
        assertThat(refundRow()).containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND7");
        assertThat(PAYPAL.seen(REFUND)).hasSize(1);
        assertThat(audit("payment.paypal.refunded", booking)).hasSize(1);
    }

    @Test
    void givenAnUnansweredRefund_whenResolvedAndTheOrderListsOnlyAPartialRefund_thenTheRequestIsRepeated()
            throws Exception {
        // given
        UUID booking = unansweredRefund();
        PAYPAL.replaceReply(READ, 200, FakePayPal.refundedOrder(booking, "REFUND7", "COMPLETED", "5.00"));
        PAYPAL.replaceReply(REFUND, 201, FakePayPal.refund("COMPLETED"));

        // when
        PayPalRefunds.Resolution resolution = payPalRefunds.resolve(refundId());

        // then
        assertThat(resolution.refund().status()).isEqualTo(PayPalRefunds.RefundStatus.COMPLETED);
        assertThat(refundRow()).as("the partial refund is never taken for this payment's refund")
                .containsEntry("status", "COMPLETED").containsEntry("refund_id", "REFUND1");
        assertThat(PAYPAL.seen(REFUND)).hasSize(2).extracting(request -> request.header("PayPal-Request-Id"))
                .as("the repeat carries the same request id").containsOnly(refundId().toString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"switched off", "another environment"})
    void givenPayPalOffOrAnotherEnvironment_whenReturning_thenItIsUnavailableAndNothingIsTaken(String cause)
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        if (cause.equals("switched off")) {
            jdbc.sql("UPDATE paypal_settings SET enabled = false").update();
        } else {
            payment.switchPayPalEnvironment("LIVE");
        }

        // when
        unavailable(refund("miles.richard", ORDER, true), UNAVAILABLE, "payment.paypal.refund.unavailable");

        // then
        assertThat(PAYPAL.seen(REFUND)).isEmpty();
        assertThat(refunds()).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND")).isZero();
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenTwoConcurrentReturns_whenBothRun_thenOnePayPalRefundAndOneEntry() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED"));
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> orderHeld = holdRow("SELECT order_id FROM paypal_order WHERE order_id = '"
                + ORDER + "' FOR UPDATE", release);

        // when
        CompletableFuture<MvcResult> first = CompletableFuture.supplyAsync(() -> proven("miles.richard"), THREADS);
        CompletableFuture<MvcResult> second = CompletableFuture.supplyAsync(() -> proven("doe.jane"), THREADS);
        awaitSessionsBlockedOnALock(2);
        release.countDown();
        orderHeld.get(10, TimeUnit.SECONDS);

        // then
        List<MvcResult> answers = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        assertThat(answers).extracting(answer -> answer.getResponse().getStatus())
                .as("one return goes through, the other is refused").containsExactlyInAnyOrder(200, 409);
        assertThat(answers).extracting(answer -> JSON.readTree(answer.getResponse().getContentAsString()))
                .anySatisfy(body -> assertThat(body.path("status").asString()).isEqualTo("COMPLETED"))
                .anySatisfy(body -> assertThat(body.path("violations").path(0).path("code").asString())
                        .isEqualTo("payment.paypal.refund.alreadyRefunded"));
        PAYPAL.only(REFUND);
        assertThat(kinds(booking, "PAYPAL_REFUND")).isEqualTo(1);
        assertThat(credit.balance(johnAccount)).isZero();
    }

    @Test
    void givenABookingRacingTheRefundForTheSameCredit_whenBothRun_thenTheBalanceNeverGoesBelowZero()
            throws Exception {
        // given
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED"));
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> accountHeld = holdRow("SELECT account_id FROM credit_account WHERE account_id = '"
                + johnAccount + "' FOR UPDATE", release);

        // when
        CompletableFuture<MvcResult> refund = CompletableFuture.supplyAsync(() -> proven("miles.richard"), THREADS);
        CompletableFuture<UUID> second = CompletableFuture.supplyAsync(() -> book(TOMORROW_AFTERNOON.plus(
                Duration.ofHours(2))), THREADS);
        awaitSessionsBlockedOnALock(2);
        release.countDown();
        accountHeld.get(10, TimeUnit.SECONDS);

        // then
        MvcResult refunded = refund.get(20, TimeUnit.SECONDS);
        UUID secondBooking = second.get(20, TimeUnit.SECONDS);
        assertThat(credit.balance(johnAccount)).as("the same credit is never spent twice").isZero();
        boolean refundTook = kinds(booking, "PAYPAL_REFUND") == 1;
        boolean bookingTook = kinds(secondBooking, "BOOKING_DEBIT") == 1;
        assertThat(refundTook).as("exactly one of the two takes the credit").isNotEqualTo(bookingTook);
        if (refundTook) {
            assertThat(refunded.getResponse().getStatus()).isEqualTo(200);
            assertThat(bookingStatus(secondBooking)).as("the booking waits for a PayPal payment instead")
                    .isEqualTo("PENDING_PAYMENT");
        } else {
            JsonNode body = JSON.readTree(refunded.getResponse().getContentAsString());
            assertThat(body.path("type").asString()).isEqualTo(REFUSED);
            assertThat(body.path("violations").path(0).path("code").asString())
                    .isEqualTo("payment.paypal.refund.creditSpent");
            assertThat(body.path("violations").path(0).path("params").path("balanceMinor").asInt()).isZero();
            assertThat(PAYPAL.seen(REFUND)).isEmpty();
        }
    }

    @Test
    void givenNoRecentAuthentication_whenReturning_thenItIsRefusedAndNothingIsTaken() throws Exception {
        // given
        UUID booking = paidAndCancelled();

        // when
        refund("miles.richard", ORDER, false)

                // then
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(PAYPAL.seen(REFUND)).isEmpty();
        assertThat(refunds()).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND")).isZero();
        assertThat(credit.balance(johnAccount)).isEqualTo(1500);
    }

    @Test
    void givenAMember_whenReturning_thenItIsForbidden() throws Exception {
        // given
        UUID booking = paidAndCancelled();

        // when
        refund("major.mary", ORDER, true)

                // then
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        mockMvc.perform(get("/api/treasury/paypal/refunds").param("accountId", johnAccount.toString())
                        .with(user(account("major.mary"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(refunds()).isZero();
        assertThat(kinds(booking, "PAYPAL_REFUND")).isZero();
    }

    @Test
    void givenAnAnonymisedPayer_whenTheirPaymentIsReturned_thenTheRefundSaysSo() throws Exception {
        // given
        UUID booking = paidAndCancelled();
        jdbc.sql("UPDATE user_account SET anonymised_at = now(), enabled = false, password_hash = NULL WHERE id = :id")
                .param("id", johnAccount).update();
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("COMPLETED"));

        // when
        refund("miles.richard", ORDER, true).andExpect(jsonPath("$.status").value("COMPLETED"));

        // then
        assertThat(credit.balance(johnAccount)).isZero();
        assertThat(audit("payment.paypal.refunded", booking)).singleElement()
                .satisfies(payload -> assertThat(payload.get("anonymised").asBoolean())
                        .as("nobody can be told of the refund").isTrue());
    }

    @Test
    void givenAnAccount_whenTheTreasurerListsItsRefunds_thenEachPaymentSaysWhetherAndWhyItCanBeReturned()
            throws Exception {
        // given
        UUID booking = paid();
        option().andExpect(jsonPath("$.items[0].refundable").value(false))
                .andExpect(jsonPath("$.items[0].blockedBy").value("payment.paypal.refund.notRefundable"));
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));
        option().andExpect(jsonPath("$.items[0].refundable").value(true))
                .andExpect(jsonPath("$.items[0].blockedBy").doesNotExist())
                .andExpect(jsonPath("$.items[0].status").doesNotExist());
        jdbc.sql("UPDATE paypal_settings SET enabled = false").update();
        option().andExpect(jsonPath("$.items[0].blockedBy").value("payment.paypal.refund.unavailable"));
        jdbc.sql("UPDATE paypal_settings SET enabled = true").update();
        credit.payOut(johnAccount, 1);
        option().andExpect(jsonPath("$.items[0].blockedBy").value("payment.paypal.refund.creditSpent"));
        credit.credit(johnAccount, 1);
        PAYPAL.reply(REFUND, 201, FakePayPal.refund("CANCELLED"));
        refund("miles.richard", ORDER, true).andExpect(jsonPath("$.status").value("FAILED"));

        // when
        option()

                // then
                .andExpect(jsonPath("$.items[0].orderId").value(ORDER))
                .andExpect(jsonPath("$.items[0].refundable").value(false))
                .andExpect(jsonPath("$.items[0].status").value("FAILED"))
                .andExpect(jsonPath("$.items[0].failureReason").value("PayPal reports the refund as CANCELLED"))
                .andExpect(jsonPath("$.items[0].blockedBy").value("payment.paypal.refund.alreadyRefunded"));
        mockMvc.perform(get("/api/treasury/paypal/refunds").param("accountId", richardAccount.toString())
                        .with(user(account("miles.richard"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    private ResultActions option() throws Exception {
        return mockMvc.perform(get("/api/treasury/paypal/refunds").param("accountId", johnAccount.toString())
                        .with(user(account("miles.richard"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].orderId").value(ORDER));
    }

    private UUID unansweredRefund() throws Exception {
        UUID booking = paidAndCancelled();
        PAYPAL.reply(REFUND, 500, "{}");
        refund("miles.richard", ORDER, true).andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(refundRow().get("refund_id")).isNull();
        return booking;
    }

    private UUID refundId() {
        return (UUID) refundRow().get("id");
    }

    private ResultActions refused(ResultActions answer, String type, String code) throws Exception {
        return answer.andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(type))
                .andExpect(jsonPath("$.violations[0].code").value(code));
    }

    private void unavailable(ResultActions answer, String type, String code) throws Exception {
        answer.andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type").value(type))
                .andExpect(jsonPath("$.violations[0].code").value(code));
    }

    private UUID paid() throws Exception {
        UUID booking = bookWithOrder();
        PAYPAL.reply(READ, 200, order("APPROVED", booking, "15.00", null));
        PAYPAL.reply(CAPTURE, 201, order("COMPLETED", booking, "15.00", FakePayPal.capture("COMPLETED", "15.00")));
        capture().andExpect(jsonPath("$.outcome").value("CONFIRMED"));
        return booking;
    }

    private UUID paidAndCancelled() throws Exception {
        UUID booking = paid();
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));
        return booking;
    }

    private UUID book(Instant startsAt) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall,
                new TimeSlot(startsAt, startsAt.plus(Duration.ofHours(1))), johnAccount, johnPerson,
                Set.of(Role.EXTERNAL), null, List.of(), null));
    }

    private UUID bookWithOrder() throws Exception {
        UUID booking = book(TOMORROW_AFTERNOON);
        PAYPAL.reply(CREATE, 201, order("PAYER_ACTION_REQUIRED", booking, "15.00", null));
        mockMvc.perform(post("/api/payments/paypal/orders").with(csrf()).with(user(account("roe.john")))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"bookingId\":\"" + booking + "\"}"))
                .andExpect(status().isOk());
        return booking;
    }

    private ResultActions capture() throws Exception {
        return mockMvc.perform(post("/api/payments/paypal/orders/{orderId}/capture", ORDER).with(csrf())
                .with(user(account("roe.john"))));
    }

    private ResultActions refund(String username, String orderId, boolean recentlyProven) throws Exception {
        MockHttpServletRequestBuilder request = post("/api/treasury/paypal/refunds").with(csrf())
                .with(user(account(username))).contentType(MediaType.APPLICATION_JSON)
                .content("{\"orderId\":\"" + orderId + "\"}");
        return mockMvc.perform(recentlyProven
                ? request.sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()) : request);
    }

    private MvcResult proven(String username) {
        try {
            return refund(username, ORDER, true).andReturn();
        } catch (Exception failed) {
            throw new IllegalStateException(failed);
        }
    }

    private CompletableFuture<Void> holdRow(String lockingQuery, CountDownLatch release) throws InterruptedException {
        CountDownLatch held = new CountDownLatch(1);
        CompletableFuture<Void> holder = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(status -> {
            jdbc.sql(lockingQuery).query().listOfRows();
            held.countDown();
            try {
                release.await(20, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }), THREADS);
        assertThat(held.await(10, TimeUnit.SECONDS)).as("the row is held").isTrue();
        return holder;
    }

    private void awaitSessionsBlockedOnALock(int sessions) throws InterruptedException {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
            int blocked = jdbc.sql("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database() AND pid <> pg_backend_pid()
                              AND state = 'active' AND wait_event_type = 'Lock'
                            """).query(Integer.class).single();
            if (blocked >= sessions) return;
            Thread.sleep(20);
        }
        throw new AssertionError("Both requests never waited on the held row. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private UserDetails account(String username) {
        return userDetails.loadUserByUsername(username);
    }

    private Map<String, Object> refundRow() {
        return jdbc.sql("""
                        SELECT id, account_id, amount_minor, currency, status, refund_id, failure_reason, requested_by
                        FROM paypal_refund
                        """)
                .query().singleRow();
    }

    private long refunds() {
        return jdbc.sql("SELECT count(*) FROM paypal_refund").query(Long.class).single();
    }

    private String bookingStatus(UUID booking) {
        return jdbc.sql("SELECT status FROM booking WHERE id = :id").param("id", booking).query(String.class).single();
    }

    private List<Map<String, Object>> entries(UUID booking) {
        return jdbc.sql("SELECT kind, amount_minor FROM credit_entry WHERE booking_id = :booking")
                .param("booking", booking).query().listOfRows();
    }

    private long kinds(UUID booking, String kind) {
        return jdbc.sql("SELECT count(*) FROM credit_entry WHERE booking_id = :booking AND kind = :kind")
                .param("booking", booking).param("kind", kind).query(Long.class).single();
    }

    private List<JsonNode> audit(String type, UUID booking) {
        return jdbc.sql("SELECT payload FROM domain_event WHERE event_type = :type AND subject_id = :id")
                .param("type", type).param("id", booking).query(String.class).list().stream()
                .map(JSON::readTree).toList();
    }

    private static String order(String status, UUID booking, String value, String capture) {
        return FakePayPal.order(status, booking, value, capture);
    }
}
