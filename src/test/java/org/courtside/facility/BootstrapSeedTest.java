package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;
import java.time.DayOfWeek;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;

class BootstrapSeedTest extends AbstractIntegrationTest {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private FacilityService facility;

    @Test
    void whenTheBootstrapSeedIsApplied_thenOneCourtAndAWholeWeekOfOpeningHoursExist() {
        // given
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V7__bootstrap.sql"))
                .execute(dataSource);

        // when
        var courts = facility.activeCourts();

        // then
        assertThat(courts).extracting(Court::getNumber)
                .as("how many courts a club has is the club's business — the seed takes no"
                        + " position beyond the one without which nothing can be booked")
                .containsExactly(1);
        assertThat(courts).extracting(Court::getName)
                .containsOnlyNulls();
        assertThat(DayOfWeek.values()).allSatisfy(day ->
                assertThat(facility.openingHoursFor(day)).hasValueSatisfying(hours -> {
                    assertThat(hours.getOpensAt()).isEqualTo(LocalTime.of(8, 0));
                    assertThat(hours.getClosesAt()).isEqualTo(LocalTime.of(22, 0));
                }));
    }
}
