package org.courtside.facility;

import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OpeningScheduleTest {

    private static final OpeningWindow SUMMER = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0));
    private static final OpeningWindow WINTER = new OpeningWindow(LocalTime.of(10, 0), LocalTime.of(18, 0));
    private static final LocalDate NOVEMBER_FIRST = LocalDate.of(2026, 11, 1);

    private final OpeningWeek origin = new OpeningWeek(UUID.randomUUID(), null,
            Map.of(DayOfWeek.MONDAY, SUMMER, DayOfWeek.SUNDAY, SUMMER));
    private final OpeningWeek winter = new OpeningWeek(UUID.randomUUID(), NOVEMBER_FIRST,
            Map.of(DayOfWeek.MONDAY, WINTER));

    @Test
    void givenAScheduledWinterWeek_whenReadingTheDayBeforeIt_thenTheOriginWeekGoverns() {
        // given
        OpeningSchedule schedule = new OpeningSchedule(List.of(winter, origin));

        // when
        var window = schedule.windowOn(LocalDate.of(2026, 10, 26));

        // then
        assertThat(window).as("a Monday before 1 November keeps the summer window").contains(SUMMER);
    }

    @Test
    void givenAScheduledWinterWeek_whenReadingItsFirstMonday_thenTheWinterWindowGoverns() {
        // given
        OpeningSchedule schedule = new OpeningSchedule(List.of(origin, winter));

        // when
        var window = schedule.windowOn(LocalDate.of(2026, 11, 2));

        // then
        assertThat(window).contains(WINTER);
    }

    @Test
    void givenAWeekThatClosesSundays_whenReadingASundayAfterItStarts_thenTheDayIsClosed() {
        // given
        OpeningSchedule schedule = new OpeningSchedule(List.of(origin, winter));

        // when
        var window = schedule.windowOn(NOVEMBER_FIRST);

        // then
        assertThat(window).as("the winter week names no Sunday, so it closes").isEmpty();
    }

    @Test
    void givenOnlyAScheduledWeek_whenReadingADayBeforeIt_thenNoWeekIsInForce() {
        // given
        OpeningSchedule schedule = new OpeningSchedule(List.of(winter));

        // when / then
        assertThat(schedule.weekOn(LocalDate.of(2026, 10, 31))).isEmpty();
    }

    @Test
    void givenTwoWeeks_whenAskingForTheNextChange_thenTheLaterStartIsNamedOnlyBeforeIt() {
        // given
        OpeningSchedule schedule = new OpeningSchedule(List.of(origin, winter));

        // when / then
        assertThat(schedule.nextChangeAfter(LocalDate.of(2026, 10, 31))).contains(NOVEMBER_FIRST);
        assertThat(schedule.nextChangeAfter(NOVEMBER_FIRST)).isEmpty();
    }

    @Test
    void givenAWeekInForceAndOneAhead_whenListingFromToday_thenBothAreListedInOrder() {
        // given
        OpeningWeek spring = new OpeningWeek(UUID.randomUUID(), LocalDate.of(2027, 3, 1), Map.of());
        OpeningSchedule schedule = new OpeningSchedule(List.of(spring, winter, origin));

        // when
        var weeks = schedule.inForceFrom(LocalDate.of(2026, 12, 1));

        // then
        assertThat(weeks).as("the origin week has been replaced and drops out")
                .containsExactly(winter, spring);
    }

    @Test
    void givenASeasonOverTheWeeklyHours_whenReadingADayInsideIt_thenTheSeasonGoverns() {
        // given
        OpeningPeriod season = period(OpeningPeriod.Kind.SEASON, LocalDate.of(2026, 5, 1), LocalDate.of(2026, 9, 30),
                Map.of(DayOfWeek.MONDAY, WINTER));
        OpeningSchedule schedule = new OpeningSchedule(List.of(origin), List.of(season));

        // when / then
        assertThat(schedule.windowOn(LocalDate.of(2026, 6, 1))).as("a Monday in the season").contains(WINTER);
        assertThat(schedule.windowOn(LocalDate.of(2026, 6, 7))).as("the season names no Sunday, so it closes")
                .isEmpty();
        assertThat(schedule.windowOn(LocalDate.of(2026, 10, 5))).as("after the season the weekly hours return")
                .contains(SUMMER);
    }

    @Test
    void givenAHolidayInsideASeason_whenReadingThatDay_thenTheHolidayGoverns() {
        // given
        OpeningPeriod season = period(OpeningPeriod.Kind.SEASON, LocalDate.of(2026, 5, 1), LocalDate.of(2026, 9, 30),
                Map.of(DayOfWeek.MONDAY, SUMMER));
        OpeningPeriod closed = period(OpeningPeriod.Kind.HOLIDAY, LocalDate.of(2026, 5, 25), LocalDate.of(2026, 5, 25),
                Map.of());
        OpeningPeriod shortened = period(OpeningPeriod.Kind.HOLIDAY, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1),
                Map.of(DayOfWeek.MONDAY, WINTER));
        OpeningSchedule schedule = new OpeningSchedule(List.of(origin), List.of(season, closed, shortened));

        // when / then
        assertThat(schedule.windowOn(LocalDate.of(2026, 5, 25))).as("a closed holiday closes the day").isEmpty();
        assertThat(schedule.windowOn(LocalDate.of(2026, 6, 1))).as("a holiday with hours replaces the season")
                .contains(WINTER);
        assertThat(schedule.windowOn(LocalDate.of(2026, 6, 8))).as("the next Monday is the season's again")
                .contains(SUMMER);
    }

    private static OpeningPeriod period(OpeningPeriod.Kind kind, LocalDate startsOn, LocalDate endsOn,
                                        Map<DayOfWeek, OpeningWindow> days) {
        return new OpeningPeriod(UUID.randomUUID(), kind, "Period", startsOn, endsOn, days);
    }
}
