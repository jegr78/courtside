package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

// It reports the path and never opens it. A mail server restarting for a minute must not turn an
// instance DOWN and have its own healthcheck restart it while nothing is wrong with the application.
@Component
@RequiredArgsConstructor
class MailRelayHealthIndicator implements HealthIndicator {

    private final MailProperties properties;

    @Override
    public Health health() {
        return Health.up()
                .withDetail("relay", properties.host() + ":" + properties.port())
                .withDetail("from", properties.from())
                .withDetail("replyTo", properties.replyTo())
                .withDetail("authenticates", MailSettings.isSet(properties.username()))
                .build();
    }
}
