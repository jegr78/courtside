package org.courtside.access.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import java.util.Locale;

// It reports the last probe and never opens a connection, so an offline clubhouse never turns the instance DOWN.
@Component
class AccessControlHealthIndicator implements HealthIndicator {

    private final ProbeReadings readings;
    private final String connector;

    AccessControlHealthIndicator(ProbeReadings readings,
                                 @Value("${courtside.access-control.connector:none}") String connector) {
        this.readings = readings;
        String selected = connector == null ? "" : connector.strip().toLowerCase(Locale.ROOT);
        this.connector = selected.isEmpty() ? "none" : selected;
    }

    @Override
    public Health health() {
        Health.Builder health = Health.up().withDetail("connector", connector);
        readings.latest().ifPresent(reading -> health
                .withDetail("reachable", reading.reachable())
                .withDetail("classification", reading.classification())
                .withDetail("checkedAt", reading.checkedAt()));
        return health.build();
    }
}
