package org.courtside.identity.internal;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("mfaKeys")
class MfaKeysHealth implements HealthIndicator {
    private volatile boolean validated;

    void validated() { validated = true; }

    @Override
    public Health health() {
        return validated ? Health.up().build() : Health.outOfService().build();
    }
}
