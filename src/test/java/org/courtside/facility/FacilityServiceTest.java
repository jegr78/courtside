package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;

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
}
