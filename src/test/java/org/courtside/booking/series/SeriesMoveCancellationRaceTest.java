package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.facility.FacilityService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
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
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Timeout(value = 60, unit = TimeUnit.SECONDS)
@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class SeriesMoveCancellationRaceTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Duration UNTIL_SETTLED = Duration.ofSeconds(20);

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @MockitoSpyBean
    private FacilityService facility;

    private UUID court;
    private UUID trainer;

    @BeforeEach
    void setUp() {
        court = facilityFixture.createCourt(1, "Court 1");
        trainer = UUID.randomUUID();
        identity.createPerson("Jane", "Doe", "jane@example.org");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenACancellationCommitsWhileAMoveRuns_whenTheMoveWritesItsRows_thenTheCancellationStands()
            throws Exception {
        // given
        SeriesCreationResult series = createSeries();
        UUID bookingId = series.bookingIds().getFirst();
        CountDownLatch moveHasReadItsBookings = new CountDownLatch(1);
        CountDownLatch cancellationCommitted = new CountDownLatch(1);
        holdTheMoveAfterItHasRead(moveHasReadItsBookings, cancellationCommitted);

        Callable<Void> moveTheSeries = () -> {
            seriesService.move(new MoveRequest(
                            series.seriesId(), bookingId, CancelScope.WHOLE_SERIES,
                            LocalTime.of(20, 0), null, null),
                    trainer, Set.of(Role.TRAINER));
            return null;
        };
        Callable<Void> cancelTheBooking = () -> {
            await(moveHasReadItsBookings, "The move never reached its read");
            bookingService.cancel(bookingId, trainer, Set.of(Role.TRAINER));
            cancellationCommitted.countDown();
            return null;
        };

        // when
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Void>> running = List.of(pool.submit(moveTheSeries), pool.submit(cancelTheBooking));
            PostgresDiagnostics.await(running.get(0), Duration.ofSeconds(40), jdbc, "Series move");
            PostgresDiagnostics.await(running.get(1), Duration.ofSeconds(40), jdbc, "Cancellation");
        }

        // then
        Booking booking = bookings.findById(bookingId).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(booking.getCancelledAt()).isNotNull();
        assertThat(booking.getCancelledBy()).isEqualTo(trainer);
    }

    // The move must not run past the point where it has read the bookings until the cancellation has
    // either committed or proved it is waiting for a lock. Letting it race would pass by accident.
    private void holdTheMoveAfterItHasRead(CountDownLatch hasRead, CountDownLatch cancelled) {
        AtomicBoolean held = new AtomicBoolean();
        doAnswer(invocation -> {
            Object answer = invocation.callRealMethod();
            if (held.compareAndSet(false, true)) {
                hasRead.countDown();
                awaitCommittedOrBlocked(cancelled);
            }
            return answer;
        }).when(facility).requireBookableCourts(any());
    }

    private void awaitCommittedOrBlocked(CountDownLatch cancelled) {
        long deadline = System.nanoTime() + UNTIL_SETTLED.toNanos();
        while (System.nanoTime() < deadline) {
            if (cancelled.getCount() == 0 || sessionsBlockedOnALock() > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("The cancellation neither committed nor waited for a lock. "
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

    private SeriesCreationResult createSeries() {
        SeriesRule rule = new SeriesRule(
                List.of(court), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 1);
        List<Instant> starts = seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER))
                .occurrences().stream().map(occurrence -> occurrence.slot().start()).toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failure);
        }
    }

    private static void await(CountDownLatch latch, String message) throws InterruptedException {
        if (!latch.await(40, TimeUnit.SECONDS)) {
            throw new AssertionError(message);
        }
    }
}
