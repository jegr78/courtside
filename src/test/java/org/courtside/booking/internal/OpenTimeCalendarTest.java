package org.courtside.booking.internal;

import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OpenTimeCalendarTest {

    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    @Test
    void givenWindowsAcrossBothChanges_whenCountingSeveralYears_thenEveryDayMatchesItsElapsedTime() {
        // given
        Map<DayOfWeek, OpeningWindow> week = new EnumMap<>(DayOfWeek.class);
        week.put(DayOfWeek.SUNDAY, new OpeningWindow(LocalTime.of(1, 30), LocalTime.of(4, 15)));
        week.put(DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        week.put(DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(2, 30), LocalTime.of(3, 0)));
        OpenTimeCalendar calendar = new OpenTimeCalendar(week, BERLIN);
        LocalDate from = LocalDate.of(2023, 12, 30);
        LocalDate to = LocalDate.of(2027, 1, 4);

        // when
        long seconds = calendar.openSeconds(from, to);
        long[][] hours = calendar.hourSeconds(from, to);

        // then
        long[][] expectedHours = new long[7][24];
        long expected = 0;
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            OpeningWindow window = week.get(date.getDayOfWeek());
            if (window == null) {
                continue;
            }
            Instant opens = ZonedDateTime.of(date, window.opensAt(), BERLIN).withLaterOffsetAtOverlap().toInstant();
            Instant closes = ZonedDateTime.of(date, window.closesAt(), BERLIN).withLaterOffsetAtOverlap().toInstant();
            for (Instant minute = opens; minute.isBefore(closes); minute = minute.plus(1, ChronoUnit.MINUTES)) {
                ZonedDateTime local = minute.atZone(BERLIN);
                expectedHours[local.getDayOfWeek().getValue() - 1][local.getHour()] += 60;
                expected += 60;
            }
        }
        assertThat(seconds).as("open seconds over the range, counted minute by minute").isEqualTo(expected);
        assertThat(hours).as("open seconds per club-local hour of the week").isEqualTo(expectedHours);
    }

    @Test
    void givenTheAutumnChange_whenCountingThatSunday_thenTheRepeatedHourCountsTwice() {
        // given
        OpenTimeCalendar calendar = new OpenTimeCalendar(
                Map.of(DayOfWeek.SUNDAY, new OpeningWindow(LocalTime.of(1, 0), LocalTime.of(5, 0))), BERLIN);
        LocalDate autumnChange = LocalDate.of(2026, 10, 25);

        // when
        long[][] hours = calendar.hourSeconds(autumnChange, autumnChange);

        // then
        assertThat(calendar.openSeconds(autumnChange, autumnChange))
                .as("five hours elapse between 01:00 and 05:00 on the autumn change").isEqualTo(Duration.ofHours(5).toSeconds());
        assertThat(hours[6][2]).as("02:00 passes twice").isEqualTo(Duration.ofHours(2).toSeconds());
    }

    @Test
    void givenAWindowTheSpringChangeSwallows_whenCountingThatDay_thenNothingWasOpen() {
        // given
        OpenTimeCalendar calendar = new OpenTimeCalendar(
                Map.of(DayOfWeek.SUNDAY, new OpeningWindow(LocalTime.of(2, 30), LocalTime.of(3, 0))), BERLIN);
        LocalDate springChange = LocalDate.of(2026, 3, 29);

        // when
        long seconds = calendar.openSeconds(springChange, springChange);

        // then
        assertThat(seconds).as("02:30 to 03:00 does not exist on the spring change").isZero();
    }

    @Test
    void givenTheWholeAcceptedRange_whenCounting_thenItAnswersWithoutWalkingEveryDay() {
        // given
        OpenTimeCalendar calendar = new OpenTimeCalendar(
                Map.of(DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(9, 0))), ZoneId.of("UTC"));

        // when
        long seconds = calendar.openSeconds(LocalDate.of(1, 1, 1), LocalDate.of(9999, 12, 31));

        // then
        long mondays = (ChronoUnit.DAYS.between(LocalDate.of(1, 1, 1), LocalDate.of(9999, 12, 31)) + 1 + 6) / 7;
        assertThat(seconds).as("one open hour on every Monday of years 0001 to 9999").isEqualTo(mondays * 3600);
    }
}
