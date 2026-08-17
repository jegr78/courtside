package org.courtside.booking;

import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
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

@Timeout(value = 30, unit = TimeUnit.SECONDS)
class BookingConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");

    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(10);

    private enum Outcome {
        SUCCEEDED,
        REJECTED
    }

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;

    @BeforeEach
    void setUp() {
        courtId = courts.save(new Court(1, "Court 1")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenAnUncommittedBookingForTheSlot_whenASecondSessionBooksTheSameSlot_thenItWaitsForTheFirstAndIsRejected()
            throws Exception {
        // given
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        CountDownLatch firstIsInPlace = new CountDownLatch(1);

        Callable<Outcome> holdTheSlotUncommitted = () -> {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                book(bookerPersonId);
                firstIsInPlace.countDown();
                awaitASessionBlockedOnALock();
            });
            return Outcome.SUCCEEDED;
        };

        Callable<Outcome> contendForTheSlot = () -> {
            await(firstIsInPlace);
            try {
                book(bookerPersonId);
                return Outcome.SUCCEEDED;
            } catch (CourtUnavailableException e) {
                return Outcome.REJECTED;
            }
        };

        // when
        List<Outcome> outcomes;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Outcome>> futures = List.of(
                    pool.submit(holdTheSlotUncommitted), pool.submit(contendForTheSlot));
            outcomes = List.of(
                    PostgresDiagnostics.await(futures.get(0), Duration.ofSeconds(20), jdbc, "First booking"),
                    PostgresDiagnostics.await(futures.get(1), Duration.ofSeconds(20), jdbc, "Competing booking"));
        }

        // then
        assertThat(outcomes).containsExactly(Outcome.SUCCEEDED, Outcome.REJECTED);
        assertThat(bookings.count()).isEqualTo(1);
    }

    private void book(UUID bookerPersonId) {
        bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), UUID.randomUUID(), bookerPersonId,
                Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null));
    }

    // Waiting is the one thing an outcome assertion cannot see.
    private void awaitASessionBlockedOnALock() {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            if (sessionsBlockedOnALock() > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError(
                "No session ever waited on a lock within " + UNTIL_CONTENTION
                        + ", so the second booking never contended with the uncommitted first one. "
                        + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    // PostgreSQL caches the statistics views per transaction.
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
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(20, TimeUnit.SECONDS)) {
            throw new AssertionError("The first booking did not reach the contention point");
        }
    }
}
