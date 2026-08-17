package org.courtside.booking.series;

import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class SeriesScheduleTest {

    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
    private static final UUID COURT = UUID.randomUUID();
    private static final UUID CARD = UUID.randomUUID();

    private final SeriesSchedule schedule = new SeriesSchedule(() -> BERLIN, 12);

    @Test
    void givenAWeeklyRuleWithAnEndDate_whenExpanding_thenEveryMatchingTuesdayIsReturned() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1, Set.of(DayOfWeek.TUESDAY),
                LocalDate.of(2026, 4, 28), null);

        // when
        SeriesSchedule.Expansion expansion = schedule.expand(rule);

        // then
        List<TimeSlot> slots = expansion.slots();
        assertThat(slots).hasSize(4);
        assertThat(slots.getFirst().start()).isEqualTo(berlin(2026, 4, 7, 18, 0));
        assertThat(slots.getLast().start()).isEqualTo(berlin(2026, 4, 28, 18, 0));
        assertThat(expansion.truncatedByHorizon()).isFalse();
    }

    @Test
    void givenACountOfThree_whenExpanding_thenExactlyThreeOccurrencesAreReturned() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1, Set.of(DayOfWeek.TUESDAY), null, 3);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots).hasSize(3);
        assertThat(slots.getLast().start()).isEqualTo(berlin(2026, 4, 21, 18, 0));
    }

    @Test
    void givenAFortnightlyRule_whenExpanding_thenEveryOtherWeekIsSkipped() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 2, Set.of(DayOfWeek.TUESDAY), null, 3);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots).extracting(TimeSlot::start).containsExactly(
                berlin(2026, 4, 7, 18, 0),
                berlin(2026, 4, 21, 18, 0),
                berlin(2026, 5, 5, 18, 0));
    }

    @Test
    void givenTwoWeekdays_whenExpanding_thenBothAreReturnedInChronologicalOrder() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1,
                Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY), null, 4);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots).extracting(TimeSlot::start).containsExactly(
                berlin(2026, 4, 7, 18, 0),
                berlin(2026, 4, 9, 18, 0),
                berlin(2026, 4, 14, 18, 0),
                berlin(2026, 4, 16, 18, 0));
    }

    @Test
    void givenAFortnightlySeriesStartingOnAThursday_whenExpanding_thenWholeCalendarWeeksAreSkipped() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 9), 2,
                Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY), null, 4);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots).extracting(TimeSlot::start).containsExactly(
                berlin(2026, 4, 9, 18, 0),
                berlin(2026, 4, 21, 18, 0),
                berlin(2026, 4, 23, 18, 0),
                berlin(2026, 5, 5, 18, 0));
    }

    @Test
    void givenAStartDateThatIsNotAMatchingWeekday_whenExpanding_thenTheFirstMatchIsAfterIt() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 6), 1, Set.of(DayOfWeek.TUESDAY), null, 1);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots.getFirst().start()).isEqualTo(berlin(2026, 4, 7, 18, 0));
    }

    @Test
    void givenASeriesCrossingTheDstChange_whenExpanding_thenEveryOccurrenceKeepsItsLocalTime() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 10, 20), 1, Set.of(DayOfWeek.TUESDAY), null, 2);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots.getFirst().start()).isEqualTo(berlin(2026, 10, 20, 18, 0));
        assertThat(slots.getLast().start()).isEqualTo(berlin(2026, 10, 27, 18, 0));
        assertThat(slots.getLast().end()).isEqualTo(berlin(2026, 10, 27, 20, 0));
        assertThat(slots.getLast().start()).isNotEqualTo(
                slots.getFirst().start().plusSeconds(7 * 24 * 3600));
    }

    @Test
    void givenASeriesCrossingTheSpringForwardChange_whenExpanding_thenEveryOccurrenceKeepsItsLocalTime() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 3, 24), 1, Set.of(DayOfWeek.TUESDAY), null, 2);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots.getFirst().start()).isEqualTo(berlin(2026, 3, 24, 18, 0));
        assertThat(slots.getLast().start()).isEqualTo(berlin(2026, 3, 31, 18, 0));
        assertThat(slots.getLast().end()).isEqualTo(berlin(2026, 3, 31, 20, 0));
        assertThat(slots.getLast().start()).isNotEqualTo(
                slots.getFirst().start().plusSeconds(7 * 24 * 3600));
    }

    @ParameterizedTest
    @MethodSource("southernHemisphereTransitions")
    void givenASeriesCrossingASouthernHemisphereChange_whenExpanding_thenEveryOccurrenceKeepsItsLocalTime(
            String zoneId, LocalDate transitionDate) {
        // given
        ZoneId zone = ZoneId.of(zoneId);
        LocalDate weekBefore = transitionDate.minusWeeks(1);
        SeriesRule rule = new SeriesRule(List.of(COURT), CARD, weekBefore, LocalTime.of(18, 0), 120,
                1, Set.of(transitionDate.getDayOfWeek()), null, 2);

        // when
        List<TimeSlot> slots = new SeriesSchedule(() -> zone, 12).expand(rule).slots();

        // then
        assertThat(slots).extracting(slot -> LocalDateTime.ofInstant(slot.start(), zone))
                .containsExactly(weekBefore.atTime(18, 0), transitionDate.atTime(18, 0));
        assertThat(slots.getLast().start())
                .isNotEqualTo(slots.getFirst().start().plus(7, ChronoUnit.DAYS));
        // Pins the direction too, and fails if the transition did not fall between the two.
        assertThat(Duration.between(slots.getFirst().start(), slots.getLast().start()))
                .isEqualTo(Duration.ofDays(7).minus(offsetShiftAfter(zone, slots.getFirst().start())));
    }

    @Test
    void givenAZoneWithoutDaylightSaving_whenExpanding_thenEveryOccurrenceKeepsItsLocalTimeAndItsOffset() {
        // given
        ZoneId zone = ZoneId.of("Asia/Kathmandu");
        assertThat(zone.getRules().nextTransition(Instant.parse("2026-01-01T00:00:00Z"))).isNull();
        SeriesRule rule = rule(LocalDate.of(2026, 10, 20), 1, Set.of(DayOfWeek.TUESDAY), null, 2);

        // when
        List<TimeSlot> slots = new SeriesSchedule(() -> zone, 12).expand(rule).slots();

        // then
        assertThat(slots.getFirst().start()).isEqualTo(Instant.parse("2026-10-20T12:15:00Z"));
        assertThat(slots.getLast().start()).isEqualTo(Instant.parse("2026-10-27T12:15:00Z"));
        assertThat(slots.getLast().start())
                .isEqualTo(slots.getFirst().start().plus(7, ChronoUnit.DAYS));
    }

    @Test
    void givenTheClubChangesItsTimeZone_whenExpandingTheNextSeries_thenTheCurrentZoneIsUsed() {
        // given
        AtomicReference<ZoneId> timeZone = new AtomicReference<>(BERLIN);
        SeriesSchedule changingSchedule = new SeriesSchedule(timeZone::get, 12);
        timeZone.set(ZoneId.of("Pacific/Auckland"));
        SeriesRule rule = rule(LocalDate.of(2026, 10, 20), 1,
                Set.of(DayOfWeek.TUESDAY), null, 1);

        // when
        TimeSlot slot = changingSchedule.expand(rule).slots().getFirst();

        // then
        assertThat(slot.start()).isEqualTo(Instant.parse("2026-10-20T05:00:00Z"));
    }

    @Test
    void givenAStartTimeInsideTheAmbiguousFallBackHour_whenExpanding_thenTheEarlierOffsetIsChosen() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 10, 18), LocalTime.of(2, 30), 1,
                Set.of(DayOfWeek.SUNDAY), null, 2);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots.getLast().start()).isEqualTo(Instant.parse("2026-10-25T00:30:00Z"));
        assertThat(slots.getLast().start()).isNotEqualTo(Instant.parse("2026-10-25T01:30:00Z"));
        // The 120 minutes are real minutes, so on the 25-hour night the slot ends at 03:30 local.
        assertThat(slots.getLast().end()).isEqualTo(Instant.parse("2026-10-25T02:30:00Z"));
    }

    @Test
    void givenAStartTimeInsideTheSpringForwardGap_whenExpanding_thenThatOccurrenceShiftsForward() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 3, 22), LocalTime.of(2, 30), 1,
                Set.of(DayOfWeek.SUNDAY), null, 2);

        // when
        List<TimeSlot> slots = schedule.expand(rule).slots();

        // then
        assertThat(slots.getFirst().start()).isEqualTo(berlin(2026, 3, 22, 2, 30));
        assertThat(slots.getLast().start()).isEqualTo(berlin(2026, 3, 29, 3, 30));
    }

    @Test
    void givenAnEndDateBeyondTheHorizon_whenExpanding_thenItStopsAtTheHorizonAndSaysSo() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1, Set.of(DayOfWeek.TUESDAY),
                LocalDate.of(2030, 4, 7), null);

        // when
        SeriesSchedule.Expansion expansion = schedule.expand(rule);

        // then
        assertThat(expansion.slots()).hasSize(53);
        assertThat(expansion.slots().getLast().start()).isEqualTo(berlin(2027, 4, 6, 18, 0));
        assertThat(expansion.truncatedByHorizon()).isTrue();
        assertThat(expansion.horizonLimit()).isEqualTo(LocalDate.of(2027, 4, 7));
    }

    @Test
    void givenACountThatLandsExactlyOnTheHorizon_whenExpanding_thenNothingIsTruncated() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1, Set.of(DayOfWeek.TUESDAY), null, 53);

        // when
        SeriesSchedule.Expansion expansion = schedule.expand(rule);

        // then
        assertThat(expansion.slots()).hasSize(53);
        assertThat(expansion.slots().getLast().start()).isEqualTo(berlin(2027, 4, 6, 18, 0));
        assertThat(expansion.truncatedByHorizon()).isFalse();
    }

    @Test
    void givenACountLargerThanTheHorizonAllows_whenExpanding_thenItStopsAtTheHorizonAndSaysSo() {
        // given
        SeriesRule rule = rule(LocalDate.of(2026, 4, 7), 1, Set.of(DayOfWeek.TUESDAY), null, 100);

        // when
        SeriesSchedule.Expansion expansion = schedule.expand(rule);

        // then
        assertThat(expansion.slots()).hasSize(53);
        assertThat(expansion.slots().getLast().start()).isEqualTo(berlin(2027, 4, 6, 18, 0));
        assertThat(expansion.truncatedByHorizon()).isTrue();
        assertThat(expansion.horizonLimit()).isEqualTo(LocalDate.of(2027, 4, 7));
    }

    private static Stream<Arguments> southernHemisphereTransitions() {
        return transitionDatesOf("Australia/Sydney", 2);
    }

    private static Stream<Arguments> transitionDatesOf(String zoneId, int count) {
        ZoneRules rules = ZoneId.of(zoneId).getRules();
        List<Arguments> transitions = new ArrayList<>();
        Instant cursor = Instant.parse("2026-01-01T00:00:00Z");
        for (int i = 0; i < count; i++) {
            ZoneOffsetTransition transition = rules.nextTransition(cursor);
            transitions.add(Arguments.of(zoneId, transition.getDateTimeBefore().toLocalDate()));
            cursor = transition.getInstant().plusSeconds(1);
        }
        return transitions.stream();
    }

    private static Duration offsetShiftAfter(ZoneId zone, Instant instant) {
        ZoneOffsetTransition transition = zone.getRules().nextTransition(instant);
        return Duration.ofSeconds(transition.getOffsetAfter().getTotalSeconds()
                - transition.getOffsetBefore().getTotalSeconds());
    }

    private SeriesRule rule(LocalDate startsOn, int intervalWeeks, Set<DayOfWeek> weekdays,
                            LocalDate endsOn, Integer count) {
        return rule(startsOn, LocalTime.of(18, 0), intervalWeeks, weekdays, endsOn, count);
    }

    private SeriesRule rule(LocalDate startsOn, LocalTime startTime, int intervalWeeks,
                            Set<DayOfWeek> weekdays, LocalDate endsOn, Integer count) {
        return new SeriesRule(List.of(COURT), CARD, startsOn, startTime, 120,
                intervalWeeks, weekdays, endsOn, count);
    }

    private static Instant berlin(int year, int month, int day, int hour, int minute) {
        return ZonedDateTime.of(year, month, day, hour, minute, 0, 0, BERLIN).toInstant();
    }
}
