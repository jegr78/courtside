package org.courtside.access.internal;

import org.courtside.access.ProbeOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.Status;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AccessControlHealthTest extends AccessPassTestSupport {

    private static final Instant CHECKED_AT = Instant.parse("2026-05-12T09:58:00Z");

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void aClient() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNoConnector_whenTheHealthIsRead_thenItIsUpAndNamesNone() {
        // given
        AccessControlHealthIndicator indicator = new AccessControlHealthIndicator(new ProbeReadings(), " ");

        // when
        Health health = indicator.health();

        // then
        assertThat(health.getStatus()).as("an instance without a connector is healthy").isEqualTo(Status.UP);
        assertThat(health.getDetails()).as("only the connector is named before any probe")
                .isEqualTo(Map.of("connector", "none"));
    }

    @Test
    void givenTheLastProbeFoundTheMiniserverUnreachable_whenTheHealthIsRead_thenItStaysUpWithTheReading() {
        // given
        readings.record(new ProbeOutcome.Unreachable("no route to the Miniserver"), CHECKED_AT);
        AccessControlHealthIndicator indicator = new AccessControlHealthIndicator(readings, "loxone");

        // when
        Health health = indicator.health();

        // then
        assertThat(health.getStatus()).as("an offline clubhouse never turns the instance down").isEqualTo(Status.UP);
        assertThat(health.getDetails()).as("the reading is reported as details, without its reason")
                .isEqualTo(Map.of("connector", "loxone", "reachable", false,
                        "classification", ProbeClassification.UNREACHABLE, "checkedAt", CHECKED_AT));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAProbeReading_whenTheBoardReadsTheAccessControlHealth_thenTheGroupShowsItAndNothingIsCalled()
            throws Exception {
        // given
        readings.record(ProbeClassification.TIMEOUT, CHECKED_AT);

        // when / then
        mockMvc.perform(get("/actuator/health/access-control"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components.accessControl.details.connector").value("simulated"))
                .andExpect(jsonPath("$.components.accessControl.details.reachable").value(false))
                .andExpect(jsonPath("$.components.accessControl.details.classification").value("TIMEOUT"))
                .andExpect(jsonPath("$.components.accessControl.details.checkedAt").value("2026-05-12T09:58:00Z"));
        assertThat(connector.calls()).as("reading the health never calls the access-control system").isEmpty();
    }

    @Test
    void givenTheMiniserverIsDown_whenTheContainerReadsTheHealth_thenTheInstanceStaysUpWithoutComponents()
            throws Exception {
        // given
        readings.record(new ProbeOutcome.Unreachable("no route to the Miniserver"), CHECKED_AT);

        // when / then
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.groups").value(hasItem("access-control")))
                .andExpect(jsonPath("$.components").doesNotExist());
        assertThat(connector.calls()).as("the container's health check never calls the access-control system")
                .isEmpty();
    }
}
