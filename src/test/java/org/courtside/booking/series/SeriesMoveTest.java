package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.CourtNotBookableException;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.Booking;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CourtAllocation;
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
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class SeriesMoveTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID LEAGUE_MATCH_CARD =
            UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

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
    void givenAFreeTarget_whenMovingTheWholeSeries_thenEveryOccurrenceShifts() {
        // given
        SeriesCreationResult series = createSeries(3);

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(3);
        assertThat(startOf(series.bookingIds().getFirst()))
                .isEqualTo(Instant.parse("2026-04-07T18:00:00Z"));
    }

    @Test
    void givenOneTargetIsTaken_whenMovingTheWholeSeries_thenNothingMovesAtAll() {
        // given
        SeriesCreationResult series = createSeries(3);
        Instant unchanged = startOf(series.bookingIds().getFirst());

        bookingService.create(new CreateBookingCommand(
                List.of(courtOne), TRAINING_CARD,
                new TimeSlot(Instant.parse("2026-04-14T18:00:00Z"),
                             Instant.parse("2026-04-14T20:00:00Z")),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));

        // when / then
        assertThatThrownBy(() -> seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(SeriesMoveConflictException.class);

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void whenMovingToAnotherCourt_thenTheAllocationFollows() {
        // given
        SeriesCreationResult series = createSeries(2);

        // when
        seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                null, null, List.of(courtTwo)), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(courtsOf(series.bookingIds().getFirst())).containsExactly(courtTwo);
    }

    @Test
    void whenMovingOnlyTheTail_thenTheEarlierOccurrencesKeepTheirTime() {
        // given
        SeriesCreationResult series = createSeries(4);
        Instant firstBefore = startOf(series.bookingIds().getFirst());

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().get(2), CancelScope.THIS_AND_FOLLOWING,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(firstBefore);
        assertThat(startOf(series.bookingIds().get(2)))
                .isEqualTo(Instant.parse("2026-04-21T18:00:00Z"));
    }

    @Test
    void givenTheNewSlotOverlapsItsOwnOldSlotOnTheSameCourt_whenMoving_thenEveryOccurrenceStillShifts() {
        // given
        SeriesCreationResult series = createSeries(3);

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(3);
        assertThat(startOf(series.bookingIds().getFirst()))
                .isEqualTo(Instant.parse("2026-04-07T17:00:00Z"));
    }

    @Test
    void givenTheCallerDoesNotOwnTheSeriesAndIsNotAdmin_whenMoving_thenNothingMovesAtAll() {
        // given
        SeriesCreationResult series = createSeries(3);
        Instant unchanged = startOf(series.bookingIds().getFirst());

        // when / then
        assertThatThrownBy(() -> seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotOwnedException.class);

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void givenALeagueMatchCreatedByASportDirector_whenAYouthDirectorMoves_thenTheActorIsRecorded() {
        // given
        SeriesCreationResult series = createLeagueMatchSeries(2);
        UUID youthDirector = UUID.randomUUID();

        // when
        seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), youthDirector, Set.of(Role.YOUTH_DIRECTOR));

        // then
        assertThat(series.bookingIds()).allSatisfy(bookingId -> {
            Booking booking = bookings.findById(bookingId).orElseThrow();
            assertThat(booking.getMovedBy()).isEqualTo(youthDirector);
            assertThat(booking.getMovedAt()).isEqualTo(Instant.parse("2026-04-01T10:00:00Z"));
        });
    }

    @Test
    void givenTheTargetCourtIsInactive_whenMoving_thenTheMoveIsRejected() {
        // given
        SeriesCreationResult series = createSeries(2);
        Court target = courts.findById(courtTwo).orElseThrow();
        target.deactivate();
        courts.save(target);
        Instant unchanged = startOf(series.bookingIds().getFirst());

        // when / then
        assertThatThrownBy(() -> seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                null, null, List.of(courtTwo)), trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(CourtNotBookableException.class);

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void givenTheTargetSlotIsOutsideOpeningHours_whenMoving_thenTheMoveIsRejected() {
        // given
        SeriesCreationResult series = createSeries(2);
        Instant unchanged = startOf(series.bookingIds().getFirst());

        // when / then
        assertThatThrownBy(() -> seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(21, 0), null, null), trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingRulesViolatedException.class);

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void givenTheTargetSlotStartsBesideTheGrid_whenMoving_thenTheMoveIsRejected() {
        // given
        SeriesCreationResult series = createSeries(2);
        Instant unchanged = startOf(series.bookingIds().getFirst());

        // when / then
        assertThatThrownBy(() -> seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 15), 45, null), trainer, Set.of(Role.TRAINER)))
                .isInstanceOfSatisfying(BookingRulesViolatedException.class, exception ->
                        assertThat(exception.getViolations()).extracting(RuleViolation::code)
                                .containsExactly("booking.rule.slotGrid.misaligned"));

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void givenAParticipantCardIsUnavailableAtTheTarget_whenMoving_thenNothingMovesAtAll() {
        // given
        SeriesCreationResult series = createSeries(1);
        Booking seriesBooking = bookings.findWithParticipantsById(series.bookingIds().getFirst()).orElseThrow();
        seriesBooking.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        bookings.saveAndFlush(seriesBooking);
        Booking competingBooking = new Booking(MEMBER_BOOKING_CARD, UUID.randomUUID(), null,
                Instant.parse("2026-04-01T10:00:00Z"));
        competingBooking.allocate(courtTwo, new TimeSlot(
                Instant.parse("2026-04-07T18:00:00Z"), Instant.parse("2026-04-07T20:00:00Z")));
        competingBooking.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        bookings.saveAndFlush(competingBooking);
        Instant unchanged = startOf(series.bookingIds().getFirst());
        MoveRequest request = new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null);

        // when
        MovePreview preview = seriesService.previewMove(request, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(preview.isExecutable()).isFalse();
        assertThat(preview.moves().getFirst().violations()).extracting(RuleViolation::code)
                .containsExactly("booking.participants.cardUnavailable");

        // when / then
        assertThatThrownBy(() -> seriesService.move(request, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.cardUnavailable");

        assertThat(startOf(series.bookingIds().getFirst())).isEqualTo(unchanged);
    }

    @Test
    void givenAParticipantCardOnTheMovingBooking_whenTargetOverlapsItsOldSlot_thenItDoesNotCountItself() {
        // given
        SeriesCreationResult series = createSeries(1);
        Booking seriesBooking = bookings.findWithParticipantsById(series.bookingIds().getFirst()).orElseThrow();
        seriesBooking.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        bookings.saveAndFlush(seriesBooking);

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isOne();
        assertThat(startOf(series.bookingIds().getFirst()))
                .isEqualTo(Instant.parse("2026-04-07T17:00:00Z"));
    }

    private Instant startOf(UUID bookingId) {
        return bookings.findWithAllocationsById(bookingId).orElseThrow()
                .getAllocations().getFirst().getStartsAt();
    }

    private List<UUID> courtsOf(UUID bookingId) {
        return bookings.findWithAllocationsById(bookingId).orElseThrow()
                .getAllocations().stream().map(CourtAllocation::getCourtId).toList();
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

    private SeriesCreationResult createLeagueMatchSeries(int count) {
        UUID sportDirector = UUID.randomUUID();
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), LEAGUE_MATCH_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
        List<Instant> starts = seriesService.preview(
                        rule, sportDirector, null, Set.of(Role.SPORT_DIRECTOR))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, sportDirector, null,
                Set.of(Role.SPORT_DIRECTOR), "League match");
    }
}
