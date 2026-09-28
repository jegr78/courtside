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
}
