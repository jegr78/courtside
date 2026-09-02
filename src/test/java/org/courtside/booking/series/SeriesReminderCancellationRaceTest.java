package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
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
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CopyOnWriteArrayList;
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
@Import({FacilityTestFixture.class, ConfigTestFixture.class, BookingTestFixture.class})
class SeriesReminderCancellationRaceTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Duration UNTIL_SETTLED = Duration.ofSeconds(20);

    @Autowired
    private SeriesService seriesService;

    @MockitoSpyBean
    private BookingService bookingService;

    @Autowired
    private BookingTestFixture reminders;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private ConfigTestFixture configuration;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID trainer;

    @BeforeEach
    void setUp() {
        court = facility.createCourt(1, "Court 1");
        trainer = UUID.randomUUID();
        configuration.remindBookingsAfter(72);
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenReminderAndSeriesOrdersOppose_whenCancellationWins_thenBothCompleteWithoutAStaleReminder()
            throws Exception {
        // given
        SeriesCreationResult series = createSeriesWhoseStartsOpposeItsIds();
        List<UUID> bookingIds = series.bookingIds();
        jdbc.sql("UPDATE booking SET created_at = :at WHERE series_id = :seriesId")
                .param("at", Instant.parse("2026-03-20T10:00:00Z").atOffset(ZoneOffset.UTC))
                .param("seriesId", series.seriesId())
                .update();
        CountDownLatch firstCancellationIsInPlace = new CountDownLatch(1);
        List<UUID> cancellationOrder = new CopyOnWriteArrayList<>();
        holdAfterFirstCancellation(firstCancellationIsInPlace, cancellationOrder);

        Callable<Void> cancelTheSeries = () -> {
            seriesService.cancel(series.seriesId(), bookingIds.getFirst(), CancelScope.WHOLE_SERIES,
                    trainer, Set.of(Role.TRAINER));
            return null;
        };
        Callable<Void> runTheReminderSweep = () -> {
            await(firstCancellationIsInPlace, "The series cancellation never wrote its first row");
            reminders.remindWhatIsDue();
            return null;
        };

        // when
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Void>> running = List.of(pool.submit(cancelTheSeries), pool.submit(runTheReminderSweep));
            PostgresDiagnostics.await(running.get(0), Duration.ofSeconds(40), jdbc, "Series cancellation");
            PostgresDiagnostics.await(running.get(1), Duration.ofSeconds(40), jdbc, "Reminder sweep");
        }

        // then
        assertThat(jdbc.sql("SELECT status FROM booking WHERE series_id = :seriesId ORDER BY id")
                .param("seriesId", series.seriesId()).query(String.class).list())
                .containsOnly(BookingStatus.CANCELLED.name());
        assertThat(jdbc.sql("SELECT reminded_at FROM booking WHERE series_id = :seriesId ORDER BY id")
                .param("seriesId", series.seriesId()).query().listOfRows())
                .allSatisfy(row -> assertThat(row.get("reminded_at")).isNull());
        assertThat(cancellationOrder).containsExactlyElementsOf(bookingIds);
    }

    private SeriesCreationResult createSeriesWhoseStartsOpposeItsIds() {
        SeriesCreationResult series = createSeries();
        if (series.bookingIds().getFirst().compareTo(series.bookingIds().getLast()) > 0) {
            return series;
        }
        UUID first = series.bookingIds().getFirst();
        jdbc.sql("""
                        UPDATE court_allocation
                        SET starts_at = starts_at + interval '2 days',
                            ends_at = ends_at + interval '2 days'
                        WHERE booking_id = :bookingId
                        """)
                .param("bookingId", first)
                .update();
        return new SeriesCreationResult(
                series.seriesId(), series.bookingIds().reversed(), series.skipped());
    }

    private SeriesCreationResult createSeries() {
        SeriesRule rule = new SeriesRule(
                List.of(court), TRAINING_CARD,
                LocalDate.of(2026, 4, 2), LocalTime.of(18, 0), 60,
                1, Set.of(DayOfWeek.THURSDAY, DayOfWeek.FRIDAY), null, 2);
        List<Instant> starts = seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER))
                .occurrences().stream().map(occurrence -> occurrence.slot().start()).toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }

    private void holdAfterFirstCancellation(CountDownLatch firstCancellationIsInPlace,
                                            List<UUID> cancellationOrder) {
        AtomicBoolean held = new AtomicBoolean();
        doAnswer(invocation -> {
            cancellationOrder.add(invocation.getArgument(0));
            Object answer = invocation.callRealMethod();
            if (held.compareAndSet(false, true)) {
                firstCancellationIsInPlace.countDown();
                awaitAnotherSessionBlockedOnALock();
            }
            return answer;
        }).when(bookingService).cancel(any(), any(), any());
    }

    private void awaitAnotherSessionBlockedOnALock() {
        long deadline = System.nanoTime() + UNTIL_SETTLED.toNanos();
        while (System.nanoTime() < deadline) {
            jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
            int blocked = jdbc.sql("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database()
                              AND pid <> pg_backend_pid()
                              AND state = 'active'
                              AND wait_event_type = 'Lock'
                            """)
                    .query(Integer.class)
                    .single();
            if (blocked > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("The reminder sweep never contended with the series cancellation. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private static void await(CountDownLatch latch, String message) throws InterruptedException {
        if (!latch.await(40, TimeUnit.SECONDS)) {
            throw new AssertionError(message);
        }
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failure);
        }
    }
}
