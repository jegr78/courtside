package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SeriesMovePreviewTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    private UUID courtOne;
    private UUID courtTwo;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        courtOne = courts.save(new Court(1, "Court 1")).getId();
        courtTwo = courts.save(new Court(2, "Court 2")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenAFreeCalendar_whenPreviewingAMoveToTwentyHundred_thenEveryOccurrenceCanMove() {
        // given
        SeriesCreationResult series = createSeries(3);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.moves()).hasSize(3);
        assertThat(preview.isExecutable()).isTrue();
        assertThat(preview.moves().getFirst().to().start())
                .isEqualTo(Instant.parse("2026-04-07T18:00:00Z"));
    }

    @Test
    void givenTheTargetSlotIsTakenOnOneDate_whenPreviewing_thenThatMoveIsBlocked() {
        // given
        SeriesCreationResult series = createSeries(3);
        bookingService.create(new CreateBookingCommand(
                List.of(courtOne), TRAINING_CARD,
                new TimeSlot(Instant.parse("2026-04-14T18:00:00Z"),
                             Instant.parse("2026-04-14T20:00:00Z")),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves().get(1).blockedCourtIds()).containsExactly(courtOne);
    }

    @Test
    void givenAMoveOfOnlyTheTail_whenPreviewing_thenTheEarlierOccurrencesAreUntouched() {
        // given
        SeriesCreationResult series = createSeries(4);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().get(2), CancelScope.THIS_AND_FOLLOWING,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.moves()).hasSize(2);
        assertThat(preview.moves()).extracting(MovePreview.Move::bookingId)
                .containsExactly(series.bookingIds().get(2), series.bookingIds().get(3));
    }

    @Test
    void givenAMoveThatChangesNothing_whenPreviewing_thenTheOccupiedSlotIsNotItsOwn() {
        // given
        SeriesCreationResult series = createSeries(2);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(18, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isTrue();
    }

    @Test
    void givenAWholeSeriesMoveThatMakesTwoOccurrencesOverlap_whenPreviewing_thenBothReportTheSharedCourtBlocked() {
        // given
        SeriesCreationResult series = createTuesdayWednesdaySeries();

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                null, 2000, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves()).allSatisfy(move ->
                assertThat(move.blockedCourtIds()).containsExactly(courtOne));
    }

    @Test
    void givenAWholeSeriesMoveWhereOnlyASiblingsOldSlotOverlaps_whenPreviewing_thenNeitherOccurrenceIsBlocked() {
        // given
        SeriesCreationResult series = createTuesdayWednesdaySeries();

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(23, 0), 1300, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.moves()).allSatisfy(move ->
                assertThat(move.blockedCourtIds()).isEmpty());
    }

    @Test
    void givenATargetSlotThatRunsPastClosingTime_whenPreviewingAMove_thenNoOccurrenceIsExecutable() {
        // given
        SeriesCreationResult series = createSeries(2);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(21, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves()).allSatisfy(move -> {
            assertThat(move.isExecutable()).isFalse();
            assertThat(move.violations()).extracting(RuleViolation::code)
                    .containsExactly("booking.rule.openingHours.outside");
        });
    }

    @Test
    void givenATargetSlotBesideTheGrid_whenPreviewingAMove_thenNoOccurrenceIsExecutable() {
        // given
        SeriesCreationResult series = createSeries(2);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 15), 45, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves()).allSatisfy(move ->
                assertThat(move.violations()).extracting(RuleViolation::code)
                        .containsExactly("booking.rule.slotGrid.misaligned"));
    }

    @Test
    void givenTheTargetCourtIsInactive_whenPreviewingAMove_thenNoOccurrenceIsExecutable() {
        // given
        SeriesCreationResult series = createSeries(2);
        Court target = courts.findById(courtTwo).orElseThrow();
        target.deactivate();
        courts.save(target);

        // when
        MovePreview preview = seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                null, null, List.of(courtTwo)), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves()).allSatisfy(move ->
                assertThat(move.unbookableCourtIds()).containsExactly(courtTwo));
    }

    @Test
    void givenTheCallerDoesNotOwnTheSeriesAndIsNotAdmin_whenPreviewingAMove_thenItIsRejected() {
        // given
        SeriesCreationResult series = createSeries(2);

        // when / then
        assertThatThrownBy(() -> seriesService.previewMove(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotOwnedException.class);
    }

    private SeriesPreview previewAsTrainer(SeriesRule rule) {
        return seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER));
    }

    private SeriesCreationResult createSeries(int count) {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
        List<Instant> starts = previewAsTrainer(rule).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }

    private SeriesCreationResult createTuesdayWednesdaySeries() {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY), null, 2);
        List<Instant> starts = previewAsTrainer(rule).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }
}
