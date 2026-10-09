package org.courtside.shared.internal;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "courtside.warm-up.enabled=true")
@Import(FacilityTestFixture.class)
class StartupWarmUpTraceTest extends AbstractIntegrationTest {

    @Autowired
    private StartupWarmUp warmUp;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MeterRegistry meters;

    @Test
    void givenAClubWithACourt_whenTheWarmUpRuns_thenEveryStepRunsAndNoTableChanges() {
        // given
        facility.createCourt(1, "Centre Court");
        Arrays.stream(DayOfWeek.values()).forEach(day ->
                facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        Map<String, String> before = contents();
        double bookingsCreated = bookingsCreated();

        // when
        StartupWarmUp.Report report = warmUp.run();

        // then
        assertThat(report.failed())
                .as("no warm-up step may fail on a configured club")
                .isEmpty();
        assertThat(report.skipped())
                .as("a club with a court must give every warm-up step something to exercise")
                .isEmpty();
        assertThat(report.ran())
                .as("the warm-up must exercise reads, the court plan, a series preview, a booking write and"
                        + " password verification")
                .containsExactlyInAnyOrder("public-reads", "court-plan", "series-preview", "booking-write",
                        "password-verification");
        assertThat(contents())
                .as("the warm-up must leave every table exactly as it found it")
                .isEqualTo(before);
        assertThat(bookingsCreated())
                .as("a booking the warm-up rolled back must not count as created")
                .isEqualTo(bookingsCreated);
    }

    @Test
    void givenAClubWithoutCourts_whenTheWarmUpRuns_thenTheBookingStepsAreSkippedRatherThanFailed() {
        // when
        StartupWarmUp.Report report = warmUp.run();

        // then
        assertThat(report.failed())
                .as("an instance nobody has set up yet must not report a failing warm-up")
                .isEmpty();
        assertThat(report.skipped())
                .as("without a court there is no series to preview and no booking to write")
                .containsExactlyInAnyOrder("series-preview", "booking-write");
    }

    private Map<String, String> contents() {
        Map<String, String> contents = new LinkedHashMap<>();
        publicTables(jdbc).forEach(table -> contents.put(table, jdbc.sql(
                        "SELECT count(*) || ':' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '')"
                                + " FROM public." + table + " t")
                .query(String.class)
                .single()));
        return contents;
    }

    private double bookingsCreated() {
        Counter counter = meters.find("courtside.bookings.created").counter();
        return counter == null ? 0 : counter.count();
    }
}
