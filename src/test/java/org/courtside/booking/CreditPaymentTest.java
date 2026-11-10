package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.DisplacedPayments;
import org.courtside.booking.internal.UnattendedRelease;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

class CreditPaymentTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");

    @Autowired
    private BookingService bookingService;
    @Autowired
    private UnattendedRelease unattendedRelease;
    @Autowired
    private DisplacedPayments displacedPayments;
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
    private RulesTestFixture rules;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate transactions;

    private UUID courtId;
    private UUID johnPerson;
    private UUID johnAccount;
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
        UUID admin = identity.createPerson("Mary", "Major", "mary.major@example.org");
        adminAccount = identity.createEnabledAccount(admin, "major.mary", Set.of(Role.MEMBER, Role.ADMIN));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(winterHall, 1500);
    }

    @Test
    void givenCreditCoveringTheAmount_whenAnExternalPlayerBooks_thenTheBookingIsConfirmedAndTheAmountDebited() {
        // given
        credit.credit(johnAccount, 2000);

        // when
        UUID booking = book(0);

        // then
        assertThat(status(booking)).isEqualTo("CONFIRMED");
        assertThat(balance()).as("the amount leaves the balance with the booking").isEqualTo(500);
        assertThat(entriesFor(booking)).containsExactly(Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
        assertThat(credit.latestBookingOf(johnAccount))
                .as("the player's ledger names the booking it paid").isEqualTo(booking);
    }

    @Test
    void givenCreditShortOfTheAmount_whenAnExternalPlayerBooks_thenTheBookingIsRefusedAndNothingIsDebited() {
        // given
        credit.credit(johnAccount, 1000);

        // when
        BookingRulesViolatedException refusal =
                catchThrowableOfType(BookingRulesViolatedException.class, () -> book(0));

        // then
        assertThat(refusal).as("too little credit refuses the booking").isNotNull();
        assertThat(refusal.getViolations()).containsExactly(new RuleViolation("booking.payment.creditInsufficient",
                Map.of("amountMinor", 1500, "balanceMinor", 1000L, "currency", "EUR")));
        assertThat(bookingsOfJohn()).as("the refused booking leaves no row").isZero();
        assertThat(balance()).isEqualTo(1000);
    }

    @Test
    void givenNoCreditAtAll_whenAnExternalPlayerBooks_thenTheRefusalNamesAZeroBalance() {
        // when
        BookingRulesViolatedException refusal =
                catchThrowableOfType(BookingRulesViolatedException.class, () -> book(0));

        // then
        assertThat(refusal).isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::params)
                .containsExactly(Map.of("amountMinor", 1500, "balanceMinor", 0L, "currency", "EUR"));
        assertThat(bookingsOfJohn()).isZero();
    }

    @Test
    void givenACardWithoutAPrice_whenAnExternalPlayerWithoutCreditBooks_thenTheBookingIsConfirmedWithoutAnEntry() {
        // given
        cards.priceForExternals(winterHall, 0);

        // when
        UUID booking = book(0);

        // then
        assertThat(status(booking)).isEqualTo("CONFIRMED");
        assertThat(entriesFor(booking)).as("a free booking writes nothing to the ledger").isEmpty();
    }

    @Test
    void givenAPaidBooking_whenThePlayerCancelsBeforeTheDeadline_thenTheFullAmountReturnsToCredit() {
        // given
        bindPeopleWithoutAMembershipTypeToADeadlineOf(60);
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);

        // when
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));

        // then
        assertThat(balance()).as("the cancellation restores the balance").isEqualTo(1500);
        assertThat(entriesFor(booking)).containsExactly(Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500),
                Map.of("kind", "BOOKING_REFUND", "amount_minor", 1500));
    }

    @Test
    void givenAPaidBookingPastTheDeadline_whenThePlayerTriesToCancel_thenNothingIsCredited() {
        // given
        bindPeopleWithoutAMembershipTypeToADeadlineOf(3000);
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);

        // when / then
        assertThatThrownBy(() -> bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL)))
                .isInstanceOf(BookingRulesViolatedException.class);
        assertThat(balance()).isZero();
        assertThat(entriesFor(booking)).extracting(entry -> entry.get("kind")).containsExactly("BOOKING_DEBIT");
    }

    @Test
    void givenAPaidBookingPastTheDeadline_whenTheClubCancelsIt_thenTheFullAmountReturnsToCredit() {
        // given
        bindPeopleWithoutAMembershipTypeToADeadlineOf(3000);
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);

        // when
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN));

        // then
        assertThat(balance()).as("a cancellation the player did not cause refunds past the deadline")
                .isEqualTo(1500);
    }

    @Test
    void givenAPaidBookingThatHasStarted_whenTheClubCancelsIt_thenNothingIsCredited() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = bookAt(NOW);

        // when
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN));

        // then
        assertThat(status(booking)).isEqualTo("CANCELLED");
        assertThat(balance()).as("a booking that has started was played or forfeited").isZero();
    }

    @Test
    void givenAPaidBookingWithoutADeadline_whenThePlayerCancelsOnceItStarted_thenNothingIsCredited() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = bookAt(NOW);

        // when
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));

        // then
        assertThat(balance()).as("without a deadline the start still ends the refund").isZero();
    }

    @Test
    void givenAPaidBookingOfAnAccountAnonymisedSince_whenTheClubCancelsIt_thenNothingIsCredited() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);
        jdbc.sql("UPDATE user_account SET anonymised_at = now(), enabled = false, password_hash = NULL WHERE id = :id")
                .param("id", johnAccount).update();

        // when
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN));

        // then
        assertThat(entriesFor(booking)).as("credit on an anonymised account could never be paid out")
                .extracting(entry -> entry.get("kind")).containsExactly("BOOKING_DEBIT");
    }

    @Test
    void givenAPaidBookingNothingClosesAnyMore_whenAStaleDisplacementReachesIt_thenItStaysAndNothingIsRefunded() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);

        // when
        boolean cancelled = transactions.execute(status -> displacedPayments.cancelCharged(booking));

        // then
        assertThat(cancelled).as("the court, card and hours admit the booking again").isFalse();
        assertThat(status(booking)).isEqualTo("CONFIRMED");
        assertThat(entriesFor(booking)).containsExactly(Map.of("kind", "BOOKING_DEBIT", "amount_minor", -1500));
    }

    @Test
    void givenACancelledPaidBooking_whenItIsCancelledAgain_thenItIsRefundedOnce() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);
        bookingService.cancel(booking, johnAccount, Set.of(Role.EXTERNAL));

        // when
        bookingService.cancel(booking, adminAccount, Set.of(Role.MEMBER, Role.ADMIN));

        // then
        assertThat(balance()).isEqualTo(1500);
        assertThat(entriesFor(booking)).hasSize(2);
    }

    @Test
    void givenAPaidBooking_whenNobodyTurnsUpAndItIsReleased_thenNothingIsCredited() {
        // given
        credit.credit(johnAccount, 1500);
        UUID booking = book(0);

        // when
        boolean released = transactions.execute(status -> unattendedRelease.release(booking));

        // then
        assertThat(released).isTrue();
        assertThat(balance()).as("a no-show keeps the amount").isZero();
    }

    @Test
    void givenABooking_whenASecondDebitOrRefundIsWrittenForIt_thenTheDatabaseRefusesIt() {
        // given
        credit.credit(johnAccount, 5000);
        UUID booking = book(0);

        // when / then
        assertThatThrownBy(() -> insertEntry(booking, "BOOKING_DEBIT", -1500))
                .hasMessageContaining("credit_entry_booking_kind");
        assertThatThrownBy(() -> insertEntry(null, "BOOKING_REFUND", 1500))
                .hasMessageContaining("credit_entry_booking_reference");
        assertThatThrownBy(() -> insertEntry(booking, "CREDIT", 1500))
                .hasMessageContaining("credit_entry_booking_reference");
        assertThatThrownBy(() -> insertEntry(booking, "BOOKING_REFUND", -1500))
                .hasMessageContaining("credit_entry_kind_sign");
    }

    @Test
    void givenCreditForOneBooking_whenASecondBookingStartsBeforeTheFirstCommits_thenExactlyOneIsConfirmed()
            throws Exception {
        // given
        credit.credit(johnAccount, 1500);
        CountDownLatch firstWritten = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        // when
        try {
            Future<Boolean> first = pool.submit(() -> transactions.execute(status -> {
                book(0);
                firstWritten.countDown();
                await(releaseFirst);
                return true;
            }));
            assertThat(firstWritten.await(10, TimeUnit.SECONDS)).isTrue();
            Future<Boolean> second = pool.submit(() -> {
                try {
                    book(2);
                    return true;
                } catch (BookingRulesViolatedException refused) {
                    return false;
                }
            });
            Thread.sleep(500);
            boolean secondWaited = !second.isDone();
            releaseFirst.countDown();

            // then
            assertThat(secondWaited).as("the second booking waits for the first").isTrue();
            assertThat(first.get(10, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(10, TimeUnit.SECONDS)).as("the second booking sees the spent credit").isFalse();
        } finally {
            releaseFirst.countDown();
            pool.shutdownNow();
        }
        assertThat(bookingsOfJohn()).isEqualTo(1);
        assertThat(balance()).isZero();
    }

    @Test
    void givenAnUpcomingPaidBookingAndNoBalance_whenTheClubChangesItsCurrency_thenTheChangeWaitsForTheBooking() {
        // given
        credit.credit(johnAccount, 1500);
        book(0);

        // when / then
        assertThatThrownBy(() -> config.chargeIn("CHF"))
                .as("a refund of the upcoming booking would land in a currency the club no longer uses")
                .hasFieldOrPropertyWithValue("code", "config.currency.creditHeld");
    }

    private UUID book(int hoursAfter) {
        return bookAt(TOMORROW_AFTERNOON.plus(Duration.ofHours(hoursAfter)));
    }

    private UUID bookAt(Instant start) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall,
                new TimeSlot(start, start.plus(Duration.ofHours(1))), johnAccount, johnPerson,
                Set.of(Role.EXTERNAL), null, List.of(), null));
    }

    private void bindPeopleWithoutAMembershipTypeToADeadlineOf(int minutes) {
        UUID ruleSet = rules.activeRuleSet("Without membership");
        rules.setCancellationDeadline(ruleSet, minutes);
        config.bindPeopleWithoutAMembershipTypeTo(ruleSet);
    }

    private long balance() {
        return credit.balance(johnAccount);
    }

    private String status(UUID booking) {
        return jdbc.sql("SELECT status FROM booking WHERE id = :id").param("id", booking).query(String.class).single();
    }

    private long bookingsOfJohn() {
        return jdbc.sql("SELECT count(*) FROM booking WHERE booked_by = :account")
                .param("account", johnAccount).query(Long.class).single();
    }

    private List<Map<String, Object>> entriesFor(UUID booking) {
        return jdbc.sql("SELECT kind, amount_minor FROM credit_entry WHERE booking_id = :booking ORDER BY position")
                .param("booking", booking).query().listOfRows();
    }

    private void insertEntry(UUID booking, String kind, int amount) {
        jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, booking_id)
                        VALUES (:id, :account, :kind, :amount, 'EUR', now(), :booking)
                        """)
                .param("id", UUID.randomUUID()).param("account", johnAccount).param("kind", kind)
                .param("amount", amount).param("booking", booking).update();
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
