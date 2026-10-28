package org.courtside.identity.internal;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

@Slf4j
@Component("mfaKeys")
class MfaKeysHealth implements HealthIndicator {
    private final MfaSecrets secrets;
    private final LongSupplier nanos;
    private final long intervalNanos;
    private volatile boolean validated;
    private String lostReason;
    private Health last;
    private long checkedAt;

    @Autowired
    MfaKeysHealth(MfaSecrets secrets) {
        this(secrets, System::nanoTime, Duration.ofSeconds(5));
    }

    MfaKeysHealth(MfaSecrets secrets, LongSupplier nanos, Duration interval) {
        this.secrets = secrets;
        this.nanos = nanos;
        this.intervalNanos = interval.toNanos();
    }

    void validated() { validated = true; }

    @Override
    public synchronized Health health() {
        if (!validated) return Health.outOfService().build();
        long now = nanos.getAsLong();
        if (last != null && now - checkedAt < intervalNanos) return last;
        checkedAt = now;
        last = verified();
        return last;
    }

    private Health verified() {
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
