package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;
import java.time.DayOfWeek;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;

class BootstrapSeedTest extends AbstractIntegrationTest {

    private static final String ORIGIN_WEEK = "eeeeeeee-0000-0000-0000-000000000100";

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private FacilityService facility;

    @Test
    void whenTheBootstrapSeedIsApplied_thenOneCourtAndAWholeWeekOfOpeningHoursExist() {
        // given
        // V7 predates the version column; V50 files its rows under the seeded origin week.
        jdbc.sql("ALTER TABLE opening_hours ALTER COLUMN version_id SET DEFAULT '" + ORIGIN_WEEK + "'").update();
        try {
            new ResourceDatabasePopulator(new ClassPathResource("db/migration/V7__bootstrap.sql"))
                    .execute(dataSource);
        } finally {
            jdbc.sql("ALTER TABLE opening_hours ALTER COLUMN version_id DROP DEFAULT").update();
        }

        // when
        var courts = facility.activeCourts();

        // then
        assertThat(courts).extracting(Court::getNumber)
                .as("how many courts a club has is the club's business — the seed takes no"
                        + " position beyond the one without which nothing can be booked")
                .containsExactly(1);
        assertThat(courts).extracting(Court::getName)
                .containsOnlyNulls();
        var weeks = facility.openingSchedule().weeks();
        assertThat(weeks).singleElement().satisfies(week -> {
            assertThat(week.effectiveFrom()).as("the seeded week governs since the beginning").isNull();
            assertThat(DayOfWeek.values()).allSatisfy(day -> assertThat(week.windowOn(day))
                    .contains(new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        });
    }
}
