package org.courtside.facility;

import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FacilityServiceTest extends AbstractIntegrationTest {

    private static final OpeningWindow EIGHT_TO_TWENTY_TWO = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0));
    private static final OpeningWindow TEN_TO_SIX = new OpeningWindow(LocalTime.of(10, 0), LocalTime.of(18, 0));
    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);
    private static final LocalDate A_MONDAY_IN_JUNE = LocalDate.of(2026, 6, 1);
    private static final LocalDate NOVEMBER_FIRST = LocalDate.of(2026, 11, 1);

    @Autowired
    private FacilityService facilityService;

    @Autowired
    private CourtRepository courtRepository;

    @Test
    void givenActiveAndInactiveCourts_whenListingActiveCourts_thenOnlyActiveOnesInNumberOrder() {
        // given
        courtRepository.save(new Court(2, "Alpha"));
        courtRepository.save(new Court(1, "Zulu"));
        Court retired = new Court(9, null);
        retired.deactivate();
        courtRepository.save(retired);

        // when
        var result = facilityService.activeCourts();

        // then
        assertThat(result).extracting(Court::getNumber).containsExactly(1, 2);
        assertThat(result).extracting(Court::getName).containsExactly("Zulu", "Alpha");
    }

    @Test
    void givenOpeningHoursSetForAWeekday_whenReadingThatDay_thenTheWindowIsReturned() {
        // given
        facilityService.setOpeningHours(DayOfWeek.MONDAY, EIGHT_TO_TWENTY_TWO);

        // when
        var result = facilityService.openingSchedule().windowOn(A_MONDAY_IN_JUNE);

        // then
        assertThat(result).contains(EIGHT_TO_TWENTY_TWO);
    }

    @Test
    void givenNoOpeningHoursForAWeekday_whenReadingThatDay_thenItIsClosed() {
        // when
        var result = facilityService.openingSchedule().windowOn(A_MONDAY_IN_JUNE.plusDays(6));

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void givenAWeekScheduledForNovember_whenReadingBeforeAndAfterIt_thenEachDayKeepsItsOwnHours() {
        // given
        facilityService.setOpeningHours(DayOfWeek.MONDAY, EIGHT_TO_TWENTY_TWO);

        // when
        facilityService.scheduleOpeningHours(NOVEMBER_FIRST, week(Map.of(DayOfWeek.MONDAY, TEN_TO_SIX)));

        // then
        OpeningSchedule schedule = facilityService.openingSchedule();
        assertThat(schedule.windowOn(LocalDate.of(2026, 10, 26))).as("the last October Monday").contains(EIGHT_TO_TWENTY_TWO);
        assertThat(schedule.windowOn(LocalDate.of(2026, 11, 2))).as("the first November Monday").contains(TEN_TO_SIX);
        assertThat(facilityService.weeklyOpeningHours().getFirst().opensAt())
                .as("today still reads the week in force today").isEqualTo(LocalTime.of(8, 0));
    }

    @Test
    void givenHoursInForceSinceTheBeginning_whenAWeekIsSavedToday_thenEarlierWeeksKeepTheirHours() {
        // given
        facilityService.setOpeningHours(DayOfWeek.MONDAY, EIGHT_TO_TWENTY_TWO);

        // when
        facilityService.setWeeklyOpeningHours(week(Map.of()));

        // then
        OpeningSchedule schedule = facilityService.openingSchedule();
        assertThat(schedule.windowOn(LocalDate.of(2026, 5, 11))).as("yesterday's Monday").contains(EIGHT_TO_TWENTY_TWO);
        assertThat(schedule.windowOn(LocalDate.of(2026, 5, 18))).as("next Monday").isEmpty();
        assertThat(schedule.weeks()).extracting(OpeningWeek::effectiveFrom).containsExactly(null, TODAY);
    }

    @Test
    void givenADayInThePast_whenSchedulingAWeekFromIt_thenItIsRefusedWithTheDayItMayStart() {
        // when / then
        assertThatThrownBy(() -> facilityService.scheduleOpeningHours(TODAY.minusDays(1), week(Map.of())))
                .isInstanceOfSatisfying(OpeningHoursStartRejectedException.class, failure -> {
                    assertThat(failure.getCode()).isEqualTo("facility.openingHours.effectiveInPast");
                    assertThat(failure.getParams()).containsEntry("today", TODAY.toString());
                });
        assertThat(facilityService.openingSchedule().weeks()).extracting(OpeningWeek::effectiveFrom)
                .as("nothing was scheduled").containsExactly((LocalDate) null);
    }

    @Test
    void givenADayBeyondTheCalendar_whenSchedulingAWeekFromIt_thenItIsRefusedWithTheLatestDay() {
        // when / then
        assertThatThrownBy(() -> facilityService.scheduleOpeningHours(LocalDate.of(10_000, 1, 1), week(Map.of())))
                .isInstanceOfSatisfying(OpeningHoursStartRejectedException.class, failure -> {
                    assertThat(failure.getCode()).isEqualTo("facility.openingHours.effectiveTooLate");
                    assertThat(failure.getParams()).containsEntry("latest", "9999-12-31");
                });
    }

    @Test
    void givenAScheduledWeek_whenAnotherWeekIsSavedForTheSameDay_thenItReplacesTheScheduledOne() {
        // given
        facilityService.scheduleOpeningHours(NOVEMBER_FIRST, week(Map.of(DayOfWeek.MONDAY, TEN_TO_SIX)));

        // when
        facilityService.scheduleOpeningHours(NOVEMBER_FIRST, week(Map.of(DayOfWeek.TUESDAY, TEN_TO_SIX)));

        // then
        OpeningSchedule schedule = facilityService.openingSchedule();
        assertThat(schedule.weeks()).extracting(OpeningWeek::effectiveFrom).containsExactly(null, NOVEMBER_FIRST);
        assertThat(schedule.windowOn(LocalDate.of(2026, 11, 2))).as("the corrected week closes Mondays").isEmpty();
        assertThat(schedule.windowOn(LocalDate.of(2026, 11, 3))).contains(TEN_TO_SIX);
    }

    @Test
    void givenAScheduledWeek_whenItIsRemoved_thenTheWeekBeforeItGovernsItsDaysAgain() {
        // given
        facilityService.setOpeningHours(DayOfWeek.MONDAY, EIGHT_TO_TWENTY_TWO);
        facilityService.scheduleOpeningHours(NOVEMBER_FIRST, week(Map.of(DayOfWeek.MONDAY, TEN_TO_SIX)));

        // when
        facilityService.removeScheduledOpeningHours(NOVEMBER_FIRST);

        // then
        assertThat(facilityService.openingSchedule().windowOn(LocalDate.of(2026, 11, 2))).contains(EIGHT_TO_TWENTY_TWO);
    }

    @Test
    void givenTheWeekInForceToday_whenRemovingIt_thenItIsRefusedAsInForce() {
        // given
        facilityService.setWeeklyOpeningHours(week(Map.of(DayOfWeek.MONDAY, EIGHT_TO_TWENTY_TWO)));

        // when / then
        assertThatThrownBy(() -> facilityService.removeScheduledOpeningHours(TODAY))
                .isInstanceOfSatisfying(OpeningHoursVersionInForceException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.openingHours.versionInForce"));
        assertThat(facilityService.openingSchedule().weeks()).hasSize(2);
    }

    @Test
    void givenNoWeekStartingOnADay_whenRemovingIt_thenItIsNotFound() {
        // when / then
        assertThatThrownBy(() -> facilityService.removeScheduledOpeningHours(NOVEMBER_FIRST))
                .isInstanceOfSatisfying(OpeningHoursVersionNotFoundException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.openingHours.versionNotFound"));
    }

    @Test
    void givenOpeningHoursOutsideTheBookingGrid_whenSavingThem_thenTheyAreRejected() {
        // when / then
        assertThatThrownBy(() -> facilityService.setOpeningHours(
                DayOfWeek.MONDAY,
                new OpeningWindow(LocalTime.of(8, 15), LocalTime.of(20, 15))))
                .isInstanceOf(OpeningHoursGridMismatchException.class)
                .satisfies(failure -> assertThat(
                        ((OpeningHoursGridMismatchException) failure).getCode())
                        .isEqualTo("facility.openingHours.slotGridMismatch"));
    }

    @Test
    void givenAStoredMonday_whenAWeekWithAMisalignedDayIsSaved_thenMondayKeepsItsWindow() {
        // given
        facilityService.setOpeningHours(DayOfWeek.MONDAY,
                EIGHT_TO_TWENTY_TWO);
        List<WeeklyOpeningHours> week = week(Map.of(
                DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(9, 0), LocalTime.of(21, 0)),
                DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 15), LocalTime.of(20, 15))));

        // when / then
        assertThatThrownBy(() -> facilityService.setWeeklyOpeningHours(week))
                .isInstanceOf(WeeklyOpeningHoursRejectedException.class);
        assertThat(facilityService.openingSchedule().windowOn(A_MONDAY_IN_JUNE)).contains(EIGHT_TO_TWENTY_TWO);
    }

    @Test
    void givenAWeek_whenSavingIt_thenEveryWeekdayComesBackInOrder() {
        // when
        List<WeeklyOpeningHours> stored = facilityService.setWeeklyOpeningHours(week(Map.of(
                DayOfWeek.TUESDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)))));

        // then
        assertThat(stored).extracting(WeeklyOpeningHours::dayOfWeek)
                .containsExactly(DayOfWeek.values());
        assertThat(stored.get(1).opensAt()).isEqualTo(LocalTime.of(8, 0));
        assertThat(stored.getLast().opensAt()).isNull();
    }

    @Test
    void givenAWeekThatNamesSixWeekdays_whenSavingIt_thenItIsRefused() {
        // given
        List<WeeklyOpeningHours> six = week(Map.of()).subList(0, 6);

        // when / then
        assertThatThrownBy(() -> facilityService.setWeeklyOpeningHours(six))
                .isInstanceOf(OpeningWeekIncompleteException.class);
    }

    private static List<WeeklyOpeningHours> week(Map<DayOfWeek, OpeningWindow> open) {
        return Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(open.get(day))
                        .map(window -> new WeeklyOpeningHours(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> new WeeklyOpeningHours(day, null, null)))
                .toList();
    }
}
