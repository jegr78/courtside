package org.courtside.shared.internal;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.WarmUpStep;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "courtside.warm-up.enabled=true")
@Import({StartupWarmUpIntegrationTest.ObservingSteps.class, FacilityTestFixture.class})
class StartupWarmUpIntegrationTest extends AbstractIntegrationTest {

    private static final List<String> FAILED = new CopyOnWriteArrayList<>();
    private static final List<Observation> OBSERVED = new CopyOnWriteArrayList<>();

    @LocalServerPort
    private int port;

    @Autowired
    private ApplicationAvailability availability;

    @Autowired
    private StartupWarmUp warmUp;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MeterRegistry meters;

    @Test
    void givenAStartingInstance_whenTheWarmUpRuns_thenHealthRefusesTrafficUntilItEnds() throws Exception {
        // given
        Observation duringWarmUp = OBSERVED.stream().findFirst().orElse(null);

        // when
        HttpResponse<String> afterWarmUp = health(port);

        // then
        assertThat(duringWarmUp)
                .as("a step must observe the instance while the warm-up holds readiness back")
                .isNotNull();
        assertThat(duringWarmUp.readiness())
                .as("readiness must be refused while the warm-up runs")
                .isEqualTo(ReadinessState.REFUSING_TRAFFIC);
        assertThat(duringWarmUp.status())
                .as("the image's health check must not report up while the warm-up runs: " + duringWarmUp.body())
                .isEqualTo(503);
        assertThat(afterWarmUp.statusCode())
                .as("the instance must report up once the warm-up has ended: " + afterWarmUp.body())
                .isEqualTo(200);
        assertThat(availability.getReadinessState())
                .as("readiness must be accepted once the warm-up has ended")
                .isEqualTo(ReadinessState.ACCEPTING_TRAFFIC);
    }

    @Test
    void givenAStepThatFails_whenTheInstanceStarts_thenTheLaterStepsStillRunAndItBecomesReady() throws Exception {
        // when
        HttpResponse<String> afterWarmUp = health(port);

        // then
        assertThat(FAILED)
                .as("the failing step must have run")
                .isNotEmpty();
        assertThat(OBSERVED)
                .as("a step after a failing one must still run")
                .isNotEmpty();
        assertThat(afterWarmUp.statusCode())
                .as("a failed warm-up step must not keep the instance from reporting up: " + afterWarmUp.body())
                .isEqualTo(200);
    }

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
                .as("no warm-up step but the deliberately failing one may fail on a configured club")
                .containsExactly("failing");
        assertThat(report.skipped())
                .as("a club with a court must give every warm-up step something to exercise")
                .isEmpty();
        assertThat(report.ran())
                .as("the warm-up must exercise reads, the court plan, a series preview, a booking write and"
                        + " password verification")
                .contains("public-reads", "court-plan", "series-preview", "booking-write",
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
                .as("an instance nobody has set up yet must not report a failing warm-up step of its own")
                .containsExactly("failing");
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

    private static HttpResponse<String> health(int port) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/actuator/health"))
                    .build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    private record Observation(ReadinessState readiness, int status, String body) {
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ObservingSteps {

        @Bean
        @Order(1)
        WarmUpStep failingWarmUpStep() {
            return new WarmUpStep() {
                @Override
                public String name() {
                    return "failing";
                }

                @Override
                public boolean run() {
                    FAILED.add(name());
                    throw new IllegalStateException("A warm-up step failed on purpose");
                }
            };
        }

        @Bean
        @Order(2)
        WarmUpStep observingWarmUpStep(ApplicationContext context, ApplicationAvailability availability) {
            return new WarmUpStep() {
                @Override
                public String name() {
                    return "observing";
                }

                @Override
                public boolean run() throws Exception {
                    if (OBSERVED.isEmpty()) {
                        int port = ((WebServerApplicationContext) context).getWebServer().getPort();
                        HttpResponse<String> response = health(port);
                        OBSERVED.add(new Observation(availability.getReadinessState(), response.statusCode(),
                                response.body()));
                    }
                    return true;
                }
            };
        }
    }
}
