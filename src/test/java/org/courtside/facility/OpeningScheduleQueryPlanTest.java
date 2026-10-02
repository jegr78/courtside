package org.courtside.facility;

import jakarta.persistence.EntityManagerFactory;
import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlCountingConfiguration;
import org.courtside.SqlStatementCounter;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

@Import(SqlCountingConfiguration.class)
class OpeningScheduleQueryPlanTest extends AbstractIntegrationTest {

    @Autowired
    private FacilityService facility;

    @Autowired
    private EntityManagerFactory entities;

    @Autowired
    private SqlStatementCounter queries;

    @Test
    void givenALoadedSchedule_whenReadingItRepeatedly_thenTheExistingQueryPlansAreReused() {
        // given
        var statistics = entities.unwrap(SessionFactory.class).getStatistics();
        boolean enabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        try {
            facility.openingSchedule();
            var hours = statistics.getQueryStatistics("SELECT h FROM OpeningHours h");
            var versions = statistics.getQueryStatistics("SELECT v FROM OpeningHoursVersion v");
            long misses = hours.getPlanCacheMissCount() + versions.getPlanCacheMissCount();
            long hits = hours.getPlanCacheHitCount() + versions.getPlanCacheHitCount();
            queries.reset();

            // when
            for (int read = 0; read < 10; read++) {
                facility.openingSchedule();
            }

            // then
            assertThat(hours.getPlanCacheMissCount() + versions.getPlanCacheMissCount() - misses).isZero();
            assertThat(hours.getPlanCacheHitCount() + versions.getPlanCacheHitCount() - hits)
                    .isGreaterThanOrEqualTo(20);
            assertThat(queries.snapshot().total()).isEqualTo(20);
        } finally {
            queries.pause();
            statistics.setStatisticsEnabled(enabled);
        }
    }

    @Test
    void givenPreparedScheduleReads_whenHoursAndVersionsChange_thenTheNextReadSeesBothChanges() {
        // given
        var monday = LocalDate.of(2026, 6, 1);
        var initial = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0));
        var corrected = new OpeningWindow(LocalTime.of(10, 0), LocalTime.of(18, 0));
        facility.setOpeningHours(DayOfWeek.MONDAY, initial);
        assertThat(facility.openingSchedule().windowOn(monday)).contains(initial);

        // when
        facility.setOpeningHours(DayOfWeek.MONDAY, corrected);
        facility.scheduleOpeningHours(LocalDate.of(2026, 11, 1), Arrays.stream(DayOfWeek.values())
                .map(day -> new WeeklyOpeningHours(day, null, null)).toList());

        // then
        var schedule = facility.openingSchedule();
        assertThat(schedule.windowOn(monday)).contains(corrected);
        assertThat(schedule.windowOn(LocalDate.of(2026, 11, 2))).isEmpty();
        assertThat(schedule.weeks()).extracting(OpeningWeek::effectiveFrom)
                .containsExactly(null, LocalDate.of(2026, 11, 1));
    }
}
