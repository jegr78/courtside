package org.courtside.shared;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
public class ClockConfiguration {

    private static final Set<String> DISPOSABLE_DESIGNATIONS =
            Set.of("UAT", "DEVELOPMENT", "PERFORMANCE");

    @Bean
    public Clock clock(@Value("${courtside.clock.fixed-instant:}") String fixedInstant,
                       @Value("${courtside.environment:}") String environment) {
        String instant = fixedInstant == null ? "" : fixedInstant.strip();
        if (instant.isEmpty()) {
            return Clock.systemUTC();
        }
        String designation = environment == null ? "" : environment.strip();
        if (!DISPOSABLE_DESIGNATIONS.contains(designation.toUpperCase(Locale.ROOT))) {
            throw new IllegalStateException(
                    "A fixed clock requires courtside.environment to name one of "
                            + "UAT, DEVELOPMENT or PERFORMANCE, but it is '" + designation + "'");
        }
        return Clock.fixed(parseInstant(instant), ZoneOffset.UTC);
    }

    private static Instant parseInstant(String instant) {
        try {
            return Instant.parse(instant);
        } catch (DateTimeParseException failure) {
            throw new IllegalStateException(
                    "courtside.clock.fixed-instant must be an ISO-8601 instant such as 2026-05-12T10:00:00Z, but it is '"
                            + instant + "'", failure);
        }
    }
}
