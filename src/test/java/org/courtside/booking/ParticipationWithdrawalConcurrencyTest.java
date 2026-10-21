package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Timeout(value = 60, unit = TimeUnit.SECONDS)
@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class})
class ParticipationWithdrawalConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));
    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(10);

    private enum Outcome {
        WITHDRAWN,
        REFUSED_AS_CANCELLED
    }

    @Autowired
    private ParticipationService participations;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingTestFixture bookingFixture;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID playerAccount;
    private UUID playerPerson;

    @BeforeEach
    void aCourtAHolderAndAPlayer() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        playerPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccount = identity.createEnabledAccount(playerPerson, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenACancellationHoldingTheBooking_whenTheCoPlayerWithdraws_thenTheWithdrawalWaitsAndIsRefused()
            throws Exception {
        // given
        UUID booking = bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT, holderAccount,
                holderPerson, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(playerPerson)), null));
        CountDownLatch cancellationIsInPlace = new CountDownLatch(1);
        CountDownLatch withdrawalFinished = new CountDownLatch(1);

        Callable<Boolean> holdCancellationUncommitted = () -> {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                bookingFixture.cancelBooking(booking, holderAccount, Set.of(Role.MEMBER));
                cancellationIsInPlace.countDown();
                awaitBlockedOrFinished(withdrawalFinished);
            });
            return true;
        };
        Callable<Outcome> withdraw = () -> {
            await(cancellationIsInPlace);
            try {
                participations.withdraw(booking, playerPerson, playerAccount);
                return Outcome.WITHDRAWN;
            } catch (ParticipationBookingCancelledException refused) {
                return Outcome.REFUSED_AS_CANCELLED;
            } finally {
                withdrawalFinished.countDown();
            }
        };

        // when
        Outcome outcome;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<Boolean> cancellation = pool.submit(holdCancellationUncommitted);
            Future<Outcome> withdrawal = pool.submit(withdraw);
            PostgresDiagnostics.await(cancellation, Duration.ofSeconds(30), jdbc, "Cancellation");
            outcome = PostgresDiagnostics.await(withdrawal, Duration.ofSeconds(30), jdbc, "Withdrawal");
        }

        // then
        assertThat(outcome).as("the withdrawal waits for the cancellation and then finds the booking cancelled")
                .isEqualTo(Outcome.REFUSED_AS_CANCELLED);
        assertThat(participantsOf(booking)).as("the cancelled booking keeps its co-player")
                .containsExactly(playerPerson);
    }

    private List<UUID> participantsOf(UUID booking) {
        return jdbc.sql("""
                        SELECT person_id FROM booking_participant
                        WHERE booking_id = :booking AND kind = 'MEMBER' AND person_id <> :holder
                        """)
                .param("booking", booking).param("holder", holderPerson).query(UUID.class).list();
    }

    private void awaitBlockedOrFinished(CountDownLatch withdrawalFinished) {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            if (withdrawalFinished.getCount() == 0 || sessionsBlockedOnALock() > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("The withdrawal neither finished nor waited for the booking lock. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private int sessionsBlockedOnALock() {
        jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
        return jdbc.sql("""
                        SELECT count(*) FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND pid <> pg_backend_pid()
                          AND state = 'active'
                          AND wait_event_type = 'Lock'
                        """)
                .query(Integer.class)
                .single();
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failure);
        }
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(20, TimeUnit.SECONDS)) {
            throw new AssertionError("The cancellation did not reach the contention point");
        }
    }
}
