package org.courtside.booking.internal;

import jakarta.persistence.EntityManagerFactory;
import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;

class ImpactServicePageTest extends AbstractIntegrationTest {

    private static final Instant FROM = Instant.parse("2026-09-05T10:00:00Z");
    private static final OpeningWindow WINDOW =
            new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(18, 0));

    @Autowired
    private ImpactService impact;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    private Statistics statistics;
    private boolean statisticsWereEnabled;

    @BeforeEach
    void enableStatistics() {
        statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statisticsWereEnabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        statistics.clear();
    }

    @AfterEach
    void restoreStatistics() {
        statistics.clear();
        statistics.setStatisticsEnabled(statisticsWereEnabled);
    }

    @Test
    void givenAnAnnouncementPage_whenReadingIt_thenItOmitsTheInteractiveCountQuery() {
        // given
        assertThat(statistics.getQueryExecutionCount()).isZero();

        // when
        ImpactService.ImpactPage page = impact.pageOfOpeningHours(
                DayOfWeek.MONDAY, WINDOW, FROM, null, 100);

        // then
        assertThat(page.bookings()).isEmpty();
        assertThat(page.nextCursor()).isNull();
        assertThat(statistics.getQueryExecutionCount()).isEqualTo(1);
    }

    @Test
    void givenAnInteractivePreview_whenReadingIt_thenItStillComputesTheAffectedCount() {
        // given
        assertThat(statistics.getQueryExecutionCount()).isZero();

        // when
        ImpactService.Impact preview = impact.ofOpeningHours(
                DayOfWeek.MONDAY, WINDOW, FROM, null, 100);

        // then
        assertThat(preview.affectedCount()).isZero();
        assertThat(preview.bookings()).isEmpty();
        assertThat(statistics.getQueryExecutionCount()).isEqualTo(2);
    }
}
