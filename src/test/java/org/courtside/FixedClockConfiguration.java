package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Value;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

@TestConfiguration(proxyBeanMethods = false)
class FixedClockConfiguration {

    @Bean
    @Primary
    Clock fixedClock(@Value("${courtside.test.clock:2026-05-12T10:00:00Z}") String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
    }
}
