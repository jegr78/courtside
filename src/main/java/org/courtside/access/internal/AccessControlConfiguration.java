package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.config.ClubTimeZone;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import javax.net.ssl.SSLContext;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import java.util.function.Supplier;

@Configuration(proxyBeanMethods = false)
@ConnectorSelected
class AccessControlConfiguration {

    @Bean
    AccessControlConnector accessControlConnector(@Value("${courtside.access-control.connector}") String connector,
                                                  @Value("${courtside.environment:}") String designation,
                                                  @Value("${courtside.access-control.call-deadline}") Duration deadline,
                                                  Environment environment, ClubTimeZone zone,
                                                  LoxoneGroupMapping groups, Clock clock) {
        return select(connector, designation, environment,
                new LoxoneWiring(zone, groups, clock, deadline, AccessControlConfiguration::defaultTls));
    }

    @Bean(destroyMethod = "close")
    CallRunner accessControlCalls(@Value("${courtside.access-control.call-deadline}") Duration deadline) {
        return new CallRunner(deadline);
    }

    record LoxoneWiring(ClubTimeZone zone, LoxoneGroupMapping groups, Clock clock, Duration callDeadline,
                        Supplier<SSLContext> tls) {
    }

    static AccessControlConnector select(String connector, String designation, Environment environment,
                                         LoxoneWiring loxone) {
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

    private static SSLContext defaultTls() {
        try {
            return SSLContext.getDefault();
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("The platform's default TLS context is unavailable", unavailable);
        }
    }
}
