package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Value;

import java.time.Instant;
import java.time.ZoneOffset;

@TestConfiguration(proxyBeanMethods = false)
class FixedClockConfiguration {

    @Bean
    @Primary
    TestClock fixedClock(@Value("${courtside.test.clock:2026-05-12T10:00:00Z}") String instant) {
        return new TestClock(Instant.parse(instant), ZoneOffset.UTC);
    }
}
