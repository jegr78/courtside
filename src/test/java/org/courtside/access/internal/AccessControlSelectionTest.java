package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AccessControlSelectionTest {

    @Test
    void givenTheSimulatedConnectorInProduction_whenItIsChosen_thenStartupFails() {
        // when / then
        assertThatThrownBy(() -> AccessControlConfiguration.select("simulated", "PRODUCTION", new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("COURTSIDE_ACCESS_CONTROL_CONNECTOR=simulated hands out codes that open nothing and is"
                        + " refused in production");
    }

    @Test
    void givenTheSimulatedConnectorOutsideProduction_whenItIsChosen_thenItIsUsed() {
        // given
        MockEnvironment demo = new MockEnvironment();
        demo.setActiveProfiles("demo");

        // when
        var development = AccessControlConfiguration.select(" Simulated ", "DEVELOPMENT", new MockEnvironment());
        var demoInProduction = AccessControlConfiguration.select("simulated", "PRODUCTION", demo);

        // then
        assertThat(development).isInstanceOf(SimulatedAccessControl.class);
        assertThat(demoInProduction).as("the demo profile guards its own environment")
                .isInstanceOf(SimulatedAccessControl.class);
    }

    @Test
    void givenAnUnknownConnector_whenItIsChosen_thenStartupNamesIt() {
        // when / then
        assertThatThrownBy(() -> AccessControlConfiguration.select("loxone", "DEVELOPMENT", new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("COURTSIDE_ACCESS_CONTROL_CONNECTOR names no known access-control system: 'loxone';"
                        + " expected none or simulated");
    }
}
