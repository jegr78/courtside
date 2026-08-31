package org.courtside.facility;

import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.OpeningHoursRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FacilityServiceTest extends AbstractIntegrationTest {

    @Autowired
    private FacilityService facilityService;

    @Autowired
    private CourtRepository courtRepository;

    @Autowired
    private OpeningHoursRepository openingHoursRepository;

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
    void givenConfiguredOpeningHours_whenLookingUpThatWeekday_thenHoursAreReturned() {
        // given
        openingHoursRepository.save(
                new OpeningHours(DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));

        // when
        var result = facilityService.openingHoursFor(DayOfWeek.MONDAY);

        // then
        assertThat(result).hasValueSatisfying(hours -> {
            assertThat(hours.getOpensAt()).isEqualTo(LocalTime.of(8, 0));
            assertThat(hours.getClosesAt()).isEqualTo(LocalTime.of(22, 0));
        });
    }

    @Test
    void givenNoOpeningHoursForAWeekday_whenLookingItUp_thenEmptyIsReturned() {
        // when
        var result = facilityService.openingHoursFor(DayOfWeek.SUNDAY);

        // then
        assertThat(result).isEmpty();
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
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        List<WeeklyOpeningHours> week = week(Map.of(
                DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(9, 0), LocalTime.of(21, 0)),
                DayOfWeek.SATURDAY, new OpeningWindow(LocalTime.of(8, 15), LocalTime.of(20, 15))));

        // when / then
        assertThatThrownBy(() -> facilityService.setWeeklyOpeningHours(week))
                .isInstanceOf(WeeklyOpeningHoursRejectedException.class);
        assertThat(facilityService.openingHoursFor(DayOfWeek.MONDAY))
                .hasValueSatisfying(hours ->
                        assertThat(hours.getOpensAt()).isEqualTo(LocalTime.of(8, 0)));
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
