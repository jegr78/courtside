package org.courtside.booking.series;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import({FacilityTestFixture.class, ConfigTestFixture.class, RulesTestFixture.class})
class SeriesCancellationTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private MeterRegistry meters;

    private UUID courtOne;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        courtOne = facilityFixture.createCourt(1, "Court 1");

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenFiveOccurrences_whenCancellingOnlyThisOne_thenExactlyOneIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(1);
        assertThat(statusesOf(result)).containsExactly(
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED, BookingStatus.CANCELLED,
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED);
    }

    @Test
    void givenOneOccurrenceIsPastTheDeadline_whenCancellingTheSeries_thenNothingIsCancelled() {
        // given
        UUID standardRuleSet = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
        config.bindPeopleWithoutAMembershipTypeTo(standardRuleSet);
        rules.setCancellationDeadline(standardRuleSet, 10080);
        SeriesCreationResult result = createSeries(3);
        double rejectedBefore = cancellationDeadlineRejections();

        // when
        BookingRulesViolatedException failure = org.assertj.core.api.Assertions.catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                        CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)));

        // then
        assertThat(failure.getViolations()).extracting(RuleViolation::code)
                .containsExactly("booking.rule.cancellationDeadline.exceeded");
        assertThat(statusesOf(result)).containsOnly(BookingStatus.CONFIRMED);
        assertThat(cancellationDeadlineRejections()).isEqualTo(rejectedBefore + 1);
    }

    private double cancellationDeadlineRejections() {
        var counter = meters.find("courtside.bookings.rejected")
                .tag("rule", "booking.rule.cancellationDeadline.exceeded")
                .counter();
        return counter == null ? 0 : counter.count();
    }

    @Test
    void givenFiveOccurrences_whenCancellingThisAndFollowing_thenTheTailIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.THIS_AND_FOLLOWING, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(3);
        assertThat(statusesOf(result)).containsExactly(
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED, BookingStatus.CANCELLED,
                BookingStatus.CANCELLED, BookingStatus.CANCELLED);
    }

    @Test
    void givenFiveOccurrences_whenCancellingTheWholeSeries_thenAllAreCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(5);
        assertThat(statusesOf(result)).allMatch(BookingStatus.CANCELLED::equals);
    }

    @Test
    void givenATrainingSeriesCreatedByATrainer_whenAYouthDirectorCancels_thenTheActorIsRecorded() {
        // given
        SeriesCreationResult result = createSeries(2);
        UUID youthDirector = UUID.randomUUID();

        // when
        seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, youthDirector, Set.of(Role.YOUTH_DIRECTOR));

        // then
        assertThat(result.bookingIds()).allSatisfy(bookingId ->
                assertThat(bookings.findById(bookingId).orElseThrow().getCancelledBy())
                        .isEqualTo(youthDirector));
    }

    @Test
    void givenAnAlreadyCancelledOccurrence_whenCancellingTheSeries_thenItIsNotCountedTwice() {
        // given
        SeriesCreationResult result = createSeries(3);
        seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(2);
    }

    @Test
    void givenAnUnknownSeries_whenCancelling_thenTheBookingItNamesDecidesTheAnswer() {
        // when / then
        assertThatThrownBy(() -> seriesService.cancel(UUID.randomUUID(), UUID.randomUUID(),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER)))
                .as("the booking is looked up before the series is spoken of, so an unknown series"
                        + " cannot be told apart from one this caller may not reach")
                .isInstanceOf(BookingNotFoundException.class);
    }

    @Test
    void givenABookingHeldByAnotherSeries_whenCancellingThroughThisOne_thenItIsRejected() {
        // given
        SeriesCreationResult theirs = createSeries(2);
        SeriesCreationResult other = createSeries(2, LocalDate.of(2026, 6, 2));

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(theirs.seriesId(),
                other.bookingIds().getFirst(), CancelScope.THIS, trainer, Set.of(Role.TRAINER)))
                .as("the caller manages the booking, so the series may be spoken of — and it says"
                        + " the booking is not in it, which is also what an unknown series says")
                .isInstanceOf(SeriesRequestInvalidException.class);
    }

    @Test
    void givenAnUnrelatedBookingId_whenCancellingThisAndFollowing_thenItIsRejected() {
        // given
        SeriesCreationResult result = createSeries(3);

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), UUID.randomUUID(),
                CancelScope.THIS_AND_FOLLOWING, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingNotFoundException.class);
    }

    @Test
    void givenAnUnrelatedBookingId_whenCancellingTheWholeSeries_thenItIsRejected() {
        // given
        SeriesCreationResult result = createSeries(3);

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), UUID.randomUUID(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingNotFoundException.class);
    }

    @Test
    void givenAMiddleOccurrenceUsesAnUnauthorizedCard_whenCancellingTheWholeSeries_thenNothingIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(3);
        jdbc.sql("UPDATE booking SET booked_by = ?, card_id = ? WHERE id = ?")
                .params(UUID.randomUUID(), UUID.fromString("44444444-4444-4444-4444-444444444444"),
                        result.bookingIds().get(1))
                .update();

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingNotFoundException.class)
                .hasMessageContaining("may not manage");
        assertThat(statusesOf(result)).allMatch(BookingStatus.CONFIRMED::equals);
    }

    @Test
    void givenACancelledOccurrenceOfAnotherAccountsSeries_whenCancellingIt_thenAccessIsRefused() {
        // given
        SeriesCreationResult result = createSeries(2);
        UUID cancelledOccurrence = result.bookingIds().getFirst();
        seriesService.cancel(result.seriesId(), cancelledOccurrence, CancelScope.THIS,
                trainer, Set.of(Role.TRAINER));

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), cancelledOccurrence,
                CancelScope.THIS, UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotFoundException.class)
                .hasMessageContaining("may not manage");
    }

    @Test
    void givenConcurrentSingleAndSeriesCancellations_whenTheSeriesWaits_thenTheFirstActorRemainsRecorded()
            throws Exception {
        // given
        SeriesCreationResult result = createSeries(2);
        UUID bookingId = result.bookingIds().getFirst();
        UUID firstActor = UUID.fromString("10000000-0000-0000-0000-000000000001");
        UUID secondActor = UUID.fromString("20000000-0000-0000-0000-000000000002");
        CountDownLatch firstCancellationIsInPlace = new CountDownLatch(1);

        Callable<Void> holdTheSingleCancellationUncommitted = () -> {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                bookingService.cancel(bookingId, firstActor, Set.of(Role.ADMIN));
                firstCancellationIsInPlace.countDown();
                awaitASessionBlockedOnALock();
            });
            return null;
        };
        Callable<Void> cancelTheSeries = () -> {
            await(firstCancellationIsInPlace);
            seriesService.cancel(result.seriesId(), bookingId, CancelScope.WHOLE_SERIES,
                    secondActor, Set.of(Role.ADMIN));
            return null;
        };

        // when
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Void>> futures = List.of(
                    pool.submit(holdTheSingleCancellationUncommitted), pool.submit(cancelTheSeries));
            PostgresDiagnostics.await(
                    futures.get(0), Duration.ofSeconds(20), jdbc, "Single cancellation");
            PostgresDiagnostics.await(
                    futures.get(1), Duration.ofSeconds(20), jdbc, "Series cancellation");
        }

        // then
        assertThat(bookings.findById(bookingId).orElseThrow().getCancelledBy()).isEqualTo(firstActor);
    }

    private void awaitASessionBlockedOnALock() {
        Duration untilContention = Duration.ofSeconds(10);
        long deadline = System.nanoTime() + untilContention.toNanos();
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
        throw new AssertionError("The series cancellation never contended with the single cancellation. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(20, TimeUnit.SECONDS)) {
            throw new AssertionError("The single cancellation did not reach the contention point");
        }
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private List<BookingStatus> statusesOf(SeriesCreationResult result) {
        return result.bookingIds().stream()
                .map(id -> bookings.findById(id).orElseThrow().getStatus())
                .toList();
    }

    private SeriesPreview previewAsTrainer(SeriesRule rule) {
        return seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER));
    }

    private SeriesCreationResult createSeries(int count) {
        return createSeries(count, LocalDate.of(2026, 4, 7));
    }

    private SeriesCreationResult createSeries(int count, LocalDate from) {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                from, LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
        List<Instant> starts = previewAsTrainer(rule).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }
}
