package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.CancellationReasonNotAllowedException;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Currency;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, ConfigTestFixture.class,
        CreditTestFixture.class, PaymentTestFixture.class, BookingTestFixture.class, RulesTestFixture.class})
class PendingPaymentWriteTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final Instant EXPIRY = NOW.plus(Duration.ofMinutes(15));
    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private BookingService bookingService;
    @Autowired
    private PendingPayments pendingPayments;
    @Autowired
    private SeriesService seriesService;
    @Autowired
    private CourtAllocationRepository allocations;
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
    private BookingTestFixture bookingFixture;
    @Autowired
    private RulesTestFixture rules;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate transactions;
    @Autowired
    private WebApplicationContext context;

    private UUID courtId;
    private UUID johnPerson;
    private UUID johnAccount;
    private UUID adminPerson;
    private UUID adminAccount;
    private UUID winterHall;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        johnPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(johnPerson, "roe.john", Set.of(Role.EXTERNAL));
        adminPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        adminAccount = identity.createEnabledAccount(adminPerson, "major.mary", Set.of(Role.MEMBER, Role.ADMIN));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(winterHall, 1500);
    }

    @Test
    void givenShortCreditAndPayPalOn_whenAnOutsiderBooks_thenTheBookingIsPendingForFifteenMinutes() {
        // given
        payment.storePayPal(true);
        credit.credit(johnAccount, 1000);

        // when
        UUID booking = book(0);

        // then
        assertThat(row(booking)).as("the court is held for the payment").isEqualTo(Map.of(
                "status", "PENDING_PAYMENT", "allocation_status", "PENDING_PAYMENT", "amount_minor", 1500,
                "payment_expires_at", EXPIRY));
        assertThat(credit.balance(johnAccount)).as("nothing is debited while PayPal is awaited").isEqualTo(1000);
        assertThat(entriesFor(booking)).isEmpty();
        assertThat(events("booking.booking.confirmed", booking)).as("a pending booking is not confirmed").isZero();
    }

    @Test
    void givenShortCreditAndPayPalOff_whenAnOutsiderBooks_thenCreditInsufficientIsReported() {
        // given
        payment.storePayPal(false);
        credit.credit(johnAccount, 1000);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class, () -> book(0));

        // then
        assertThat(refusal).as("without PayPal short credit still refuses").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .containsExactly("booking.payment.creditInsufficient");
        assertThat(bookingsOfJohn()).isZero();
    }

    @Test
    void givenAPendingBooking_whenTheSameAccountBooksAgain_thenPendingExistsIsReported() {
        // given
        payment.storePayPal(true);
        book(0);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class, () -> book(2));

        // then
        assertThat(refusal).as("one pending booking per account").isNotNull();
        assertThat(refusal.getViolations()).containsExactly(
                new RuleViolation("booking.payment.pendingExists", Map.of("expiresAt", EXPIRY.toString())));
        assertThat(bookingsOfJohn()).isEqualTo(1);
    }

    @Test
    void givenAPendingBookingCommittingDuringTheWrite_whenTheIndexRefusesTheSecond_thenPendingExistsIsReported()
            throws Exception {
        // given
        payment.storePayPal(true);
        Instant otherExpiry = NOW.plus(Duration.ofMinutes(9));
        CountDownLatch inserted = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        CompletableFuture<Void> first = CompletableFuture.runAsync(() -> transactions.executeWithoutResult(status -> {
            bookingFixture.createPendingBooking(courtId, winterHall, slot(4), johnAccount, otherExpiry);
            inserted.countDown();
            await(commit);
        }));
        assertThat(inserted.await(10, TimeUnit.SECONDS)).isTrue();

        // when
        CompletableFuture<Throwable> second = CompletableFuture.supplyAsync(() -> {
            try {
                book(0);
                return null;
            } catch (RuntimeException refused) {
                return refused;
            }
        });
        awaitWaitOnTheIndex();
        commit.countDown();
        first.get(10, TimeUnit.SECONDS);
        Throwable refusal = second.get(10, TimeUnit.SECONDS);

        // then
        assertThat(refusal).as("the index answers like the pre-check").isInstanceOf(BookingRulesViolatedException.class);
        assertThat(((BookingRulesViolatedException) refusal).getViolations()).containsExactly(
                new RuleViolation("booking.payment.pendingExists", Map.of("expiresAt", otherExpiry.toString())));
        assertThat(bookingsOfJohn()).isEqualTo(1);
    }

    @Test
    void givenAPendingBooking_whenConfirmedTwice_thenItConfirmsOnceAndPublishesOneConfirmation() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when
        PendingPayments.ConfirmOutcome firstOutcome = transactions.execute(status -> pendingPayments.confirm(booking));
        PendingPayments.ConfirmOutcome secondOutcome = transactions.execute(status -> pendingPayments.confirm(booking));

        // then
        assertThat(firstOutcome).isEqualTo(PendingPayments.ConfirmOutcome.CONFIRMED);
        assertThat(secondOutcome).isEqualTo(PendingPayments.ConfirmOutcome.ALREADY_CONFIRMED);
        assertThat(row(booking)).containsEntry("status", "CONFIRMED").containsEntry("allocation_status", "CONFIRMED");
        assertThat(events("booking.booking.confirmed", booking)).as("one confirmation for two confirms").isEqualTo(1);
        assertThat(pendingPayments.pending(booking)).as("a confirmed booking awaits nothing").isEmpty();
    }

    @Test
    void givenAPendingBooking_whenConfirmedOutsideATransaction_thenTheCallIsRefused() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when / then
        assertThatThrownBy(() -> pendingPayments.confirm(booking))
                .as("the caller's transaction holds the row lock up to its own ledger write")
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(row(booking)).containsEntry("status", "PENDING_PAYMENT");
    }

    @Test
    void givenAReleasedOrCreditPaidBooking_whenConfirmed_thenItIsNotPending() {
        // given
        payment.storePayPal(true);
        UUID released = book(0);
        pendingPayments.release(released);
        credit.credit(johnAccount, 1500);
        UUID paid = book(2);

        // when
        PendingPayments.ConfirmOutcome afterRelease = transactions.execute(status -> pendingPayments.confirm(released));
        PendingPayments.ConfirmOutcome creditPaid = transactions.execute(status -> pendingPayments.confirm(paid));
        PendingPayments.ConfirmOutcome unknown =
                transactions.execute(status -> pendingPayments.confirm(UUID.randomUUID()));

        // then
        assertThat(List.of(afterRelease, creditPaid, unknown)).as("released, paid from credit, unknown")
                .containsOnly(PendingPayments.ConfirmOutcome.NOT_PENDING);
        assertThat(row(released)).containsEntry("status", "CANCELLED");
    }

    @Test
    void givenAPendingBooking_whenReadForPayment_thenItCarriesTheServerAmountAndExpiry() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when
        var pending = pendingPayments.pending(booking);

        // then
        assertThat(pending).contains(new PendingPayments.PendingBooking(booking, johnAccount, 1500,
                Currency.getInstance("EUR"), EXPIRY));
        assertThat(pendingPayments.pendingSince(NOW)).as("created at the instant, not before it").isEmpty();
        assertThat(pendingPayments.pendingSince(NOW.plusSeconds(1))).containsExactly(booking);
        assertThat(pendingPayments.expiredAt(EXPIRY.minusSeconds(1))).isEmpty();
        assertThat(pendingPayments.expiredAt(EXPIRY)).containsExactly(booking);
    }

    @Test
    void givenAPendingBooking_whenReleased_thenTheCourtIsFreeAndNoCancellationMailIsQueued() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when
        boolean released = pendingPayments.release(booking);
        boolean releasedAgain = pendingPayments.release(booking);

        // then
        assertThat(released).isTrue();
        assertThat(releasedAgain).as("a release happens once").isFalse();
        assertThat(cancellation(booking)).isEqualTo(Map.of("status", "CANCELLED",
                "cancellation_reason", "PAYMENT_EXPIRED", "allocation_status", "CANCELLED"));
        assertThat(allocations.existsOccupyingOverlapping(List.of(courtId), slot(0).start(), slot(0).end()))
                .as("the court is free again").isFalse();
        assertThat(events("booking.booking.cancelled", booking)).as("a release is no cancellation").isZero();
        assertThat(events("booking.payment.expired", booking)).isEqualTo(1);
        assertThat(notificationsFor(booking)).as("nothing is queued for the booker").isZero();
        assertThat(book(0)).as("the account may hold a new payment").isNotEqualTo(booking);
    }

    @Test
    void givenAPendingBooking_whenTheBoardCancelsIt_thenItIsReleasedWithoutACancellation() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN), CancellationReason.WEATHER);

        // then
        assertThat(cancellation(booking)).containsEntry("status", "CANCELLED")
                .containsEntry("cancellation_reason", "PAYMENT_EXPIRED");
        assertThat(events("booking.booking.cancelled", booking)).as("no cancellation mail follows").isZero();
        assertThat(events("booking.payment.expired", booking)).isEqualTo(1);
        assertThat(entriesFor(booking)).as("nothing was debited, so nothing is refunded").isEmpty();
    }

    @Test
    void givenAPendingBooking_whenTheBookerAbandonsIt_thenItIsReleased() {
        // given
        payment.storePayPal(true);
        UUID booking = book(0);

        // when
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));

        // then
        assertThat(cancellation(booking)).containsEntry("cancellation_reason", "PAYMENT_EXPIRED");
        assertThat(events("booking.booking.cancelled", booking)).isZero();
        assertThat(events("booking.payment.expired", booking)).isEqualTo(1);
    }

    @Test
    void givenAPendingBookingPastItsCancellationDeadline_whenItsOwnerCancelsItOverHttp_thenTheCourtIsFreeAtOnce()
            throws Exception {
        // given
        payment.storePayPal(true);
        UUID ruleSet = rules.activeRuleSet("Without membership");
        rules.setCancellationDeadline(ruleSet, 525600);
        config.bindPeopleWithoutAMembershipTypeTo(ruleSet);
        UUID booking = book(0);
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        // when
        var cancelled = mockMvc.perform(delete("/api/bookings/{id}", booking)
                .with(user("roe.john").roles("EXTERNAL")).with(csrf()));

        // then
        cancelled.andExpect(status().isNoContent());
        assertThat(cancellation(booking)).as("an unpaid hold is given up whatever the deadline says")
                .containsEntry("status", "CANCELLED").containsEntry("cancellation_reason", "PAYMENT_EXPIRED")
                .containsEntry("allocation_status", "CANCELLED");
        UUID next = bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall, slot(0),
                adminAccount, adminPerson, Set.of(Role.MEMBER, Role.ADMIN), null, List.of(), null));
        assertThat(cancellation(next)).as("the released court takes the next booking")
                .containsEntry("status", "CONFIRMED");
    }

    @Test
    void givenAPaymentExpiredReason_whenTheBoardCancelsABookingOrASeries_thenTheReasonIsRefused() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);
        UUID series = bookingFixture.createSeries(courtId, TRAINING_CARD, LocalDate.of(2026, 5, 19),
                LocalTime.of(9, 0), 60, 2, adminAccount, adminPerson, Set.of(Role.MEMBER, Role.ADMIN));

        // when
        CancellationReasonNotAllowedException single = catchThrowableOfType(
                CancellationReasonNotAllowedException.class, () -> bookingService.cancel(booking, adminAccount,
                        Set.of(Role.MEMBER, Role.ADMIN), CancellationReason.PAYMENT_EXPIRED));
        CancellationReasonNotAllowedException wholeSeries = catchThrowableOfType(
                CancellationReasonNotAllowedException.class, () -> seriesService.cancel(series,
                        bookingFixture.firstOccurrenceOf(series), CancelScope.WHOLE_SERIES, adminAccount,
                        Set.of(Role.MEMBER, Role.ADMIN), CancellationReason.PAYMENT_EXPIRED));

        // then
        assertThat(single).as("only a release records an expired payment").isNotNull()
                .hasFieldOrPropertyWithValue("code", "booking.cancellationReason.reserved");
        assertThat(wholeSeries).isNotNull().hasFieldOrPropertyWithValue("code", "booking.cancellationReason.reserved");
        assertThat(cancellation(booking)).containsEntry("status", "CONFIRMED");
    }

    @Test
    void givenAPendingBooking_whenTheCourtIsClosedThatDay_thenItIsReleasedAndNotDisplaced() {
        // given
        payment.storePayPal(true);
        UUID pending = book(0);
        UUID confirmed = bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall, slot(2),
                adminAccount, adminPerson, Set.of(Role.MEMBER, Role.ADMIN), null, List.of(), null));

        // when
        facility.closeCourt(courtId, LocalDate.of(2026, 5, 13), LocalDate.of(2026, 5, 13));

        // then
        assertThat(cancellation(pending)).containsEntry("status", "CANCELLED")
                .containsEntry("cancellation_reason", "PAYMENT_EXPIRED");
        assertThat(events("booking.booking.displaced", pending)).as("a released hold is not displaced").isZero();
        assertThat(events("booking.payment.expired", pending)).isEqualTo(1);
        assertThat(events("booking.booking.displaced", confirmed)).as("a confirmed booking still is").isEqualTo(1);
    }

    @Test
    void givenTheBoardBookingForAnOutsider_whenCreditIsShort_thenNoPendingBookingIsWritten() {
        // given
        payment.storePayPal(true);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall, slot(0),
                        johnAccount, johnPerson, Set.of(Role.EXTERNAL), null, List.of(), null, adminAccount)));

        // then
        assertThat(refusal).as("only the outsider paying for themselves goes to PayPal").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .containsExactly("booking.payment.creditInsufficient");
        assertThat(bookingsOfJohn()).isZero();
    }

    @Test
    void givenARequestCarryingAnAmount_whenBooked_thenTheStoredAmountIsTheServerAmount() throws Exception {
        // given
        payment.storePayPal(true);
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        String request = """
                {"courtIds": ["%s"], "cardId": "%s", "startsAt": "%s", "endsAt": "%s"%s}
                """;
        TimeSlot slot = slot(0);

        // when
        var withAmount = mockMvc.perform(post("/api/bookings").header("Idempotency-Key", UUID.randomUUID().toString())
                .with(user("roe.john").roles("EXTERNAL")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(request.formatted(courtId, winterHall, slot.start(), slot.end(), ", \"amountMinor\": 1")));
        var plain = mockMvc.perform(post("/api/bookings").header("Idempotency-Key", UUID.randomUUID().toString())
                .with(user("roe.john").roles("EXTERNAL")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(request.formatted(courtId, winterHall, slot.start(), slot.end(), "")));

        // then
        withAmount.andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"));
        plain.andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_PAYMENT"))
                .andExpect(jsonPath("$.paymentExpiresAt").value("2026-05-12T10:15:00Z"));
        assertThat(jdbc.sql("SELECT amount_minor FROM booking WHERE booked_by = :account")
                .param("account", johnAccount).query(Integer.class).list())
                .as("a client never names what it pays").containsExactly(1500);
    }

    private UUID book(int hoursAfter) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall, slot(hoursAfter),
                johnAccount, johnPerson, Set.of(Role.EXTERNAL), null, List.of(), null));
    }

    private static TimeSlot slot(int hoursAfter) {
        Instant start = TOMORROW_AFTERNOON.plus(Duration.ofHours(hoursAfter));
        return new TimeSlot(start, start.plus(Duration.ofHours(1)));
    }

    private Map<String, Object> row(UUID booking) {
        return jdbc.sql("""
                        SELECT b.status, a.status AS allocation_status, b.amount_minor, b.payment_expires_at
                        FROM booking b JOIN court_allocation a ON a.booking_id = b.id WHERE b.id = :id
                        """)
                .param("id", booking)
                .query((rs, n) -> Map.<String, Object>of("status", rs.getString(1), "allocation_status",
                        rs.getString(2), "amount_minor", rs.getInt(3), "payment_expires_at",
                        rs.getTimestamp(4).toInstant()))
                .single();
    }

    private Map<String, Object> cancellation(UUID booking) {
        return jdbc.sql("""
                        SELECT b.status, b.cancellation_reason, a.status AS allocation_status
                        FROM booking b JOIN court_allocation a ON a.booking_id = b.id WHERE b.id = :id
                        """)
                .param("id", booking).query().singleRow();
    }

    private long events(String type, UUID booking) {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = :type AND subject_id = :id")
                .param("type", type).param("id", booking).query(Long.class).single();
    }

    private long notificationsFor(UUID booking) {
        return jdbc.sql("SELECT count(*) FROM notification WHERE parameters ->> 'bookingId' = :id")
                .param("id", booking.toString()).query(Long.class).single();
    }

    private long bookingsOfJohn() {
        return jdbc.sql("SELECT count(*) FROM booking WHERE booked_by = :account")
                .param("account", johnAccount).query(Long.class).single();
    }

    private List<Map<String, Object>> entriesFor(UUID booking) {
        return jdbc.sql("SELECT kind, amount_minor FROM credit_entry WHERE booking_id = :booking")
                .param("booking", booking).query().listOfRows();
    }

    private void awaitWaitOnTheIndex() throws InterruptedException {
        for (int attempt = 0; attempt < 400; attempt++) {
            boolean waiting = jdbc.sql("""
                    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                        WHERE wait_event_type = 'Lock' AND query ILIKE 'update booking %')
                    """).query(Boolean.class).single();
            if (waiting) {
                return;
            }
            Thread.sleep(25);
        }
        throw new AssertionError("the second write never waited on the first pending booking");
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
