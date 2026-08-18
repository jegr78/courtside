package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.PostgresDiagnostics;
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

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingIdempotencyConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(10);

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    private CreateBookingCommand command;

    @BeforeEach
    void setUp() {
        UUID courtId = facilityFixture.createCourt(1, "Court 1");
        UUID personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        command = new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), personId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null);
    }

    @Test
    void givenAnUncommittedRequest_whenTheSameKeyIsRetried_thenItWaitsAndReturnsTheOriginalBooking()
            throws Exception {
        // given
        String key = UUID.randomUUID().toString();
        CountDownLatch firstIsInPlace = new CountDownLatch(1);
        Callable<UUID> holdFirstRequestUncommitted = () -> {
            UUID[] bookingId = new UUID[1];
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                bookingId[0] = bookingService.create(command, key);
                firstIsInPlace.countDown();
                awaitASessionBlockedOnALock();
            });
            return bookingId[0];
        };
        Callable<UUID> retryRequest = () -> {
            await(firstIsInPlace);
            return bookingService.create(command, key);
        };

        // when
        List<UUID> bookingIds;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<UUID>> futures = List.of(
                    pool.submit(holdFirstRequestUncommitted), pool.submit(retryRequest));
            bookingIds = List.of(
                    PostgresDiagnostics.await(futures.get(0), Duration.ofSeconds(20), jdbc, "First request"),
                    PostgresDiagnostics.await(futures.get(1), Duration.ofSeconds(20), jdbc, "Retry request"));
        }

        // then
        assertThat(bookingIds).containsOnly(bookingIds.getFirst());
        assertThat(bookings.count()).isOne();
    }

    private void awaitASessionBlockedOnALock() {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            if (sessionsBlockedOnALock() > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("No retry waited for the idempotency key. "
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
            throw new AssertionError("The first request did not reach the contention point");
        }
    }
}
