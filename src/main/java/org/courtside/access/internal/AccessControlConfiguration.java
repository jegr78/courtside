package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import java.time.Duration;
import java.util.Locale;

@Configuration(proxyBeanMethods = false)
@ConnectorSelected
class AccessControlConfiguration {

    @Bean
    AccessControlConnector accessControlConnector(@Value("${courtside.access-control.connector}") String connector,
                                                  @Value("${courtside.environment:}") String designation,
                                                  Environment environment) {
        return select(connector, designation, environment);
    }

    @Bean(destroyMethod = "close")
    CallRunner accessControlCalls(@Value("${courtside.access-control.call-deadline}") Duration deadline) {
        return new CallRunner(deadline);
    }

    static AccessControlConnector select(String connector, String designation, Environment environment) {
        String selected = connector == null ? "" : connector.strip().toLowerCase(Locale.ROOT);
        if (!SimulatedAccessControl.NAME.equals(selected)) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR names no known access-control "
                    + "system: '" + connector + "'; expected none or simulated");
        }
        boolean production = designation != null && "PRODUCTION".equalsIgnoreCase(designation.strip());
        if (production && !environment.acceptsProfiles(Profiles.of("demo"))) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR=simulated hands out codes that "
                    + "open nothing and is refused in production");
        }
        return new SimulatedAccessControl();
    }
}
