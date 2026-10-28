package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import java.util.Objects;

@Slf4j
@Component("mfaKeys")
@RequiredArgsConstructor
class MfaKeysHealth implements HealthIndicator {
    private final MfaSecrets secrets;
    private volatile boolean validated;
    private volatile String lostReason;

    void validated() { validated = true; }

    @Override
    public Health health() {
        if (!validated) return Health.outOfService().build();
        try {
            secrets.verify();
        } catch (IllegalStateException failure) {
            String reason = failure.getMessage();
            if (!Objects.equals(reason, lostReason)) log.warn("MFA key material failed its health check: {}", reason);
            lostReason = reason;
            return Health.down().withDetail("reason", reason).build();
        }
        if (lostReason != null) log.info("MFA key material passed its health check again");
        lostReason = null;
        return Health.up().build();
    }
}
