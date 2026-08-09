package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.ZoneOffset;

@Component
@RequiredArgsConstructor
class LoginAttemptCleanup {

    private final JdbcClient jdbc;
    private final LoginProtectionProperties properties;
    private final Clock clock;

    @Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT1H")
    @Transactional
    void deleteExpiredAttempts() {
        jdbc.sql("DELETE FROM login_attempt_limit WHERE window_started_at < :cutoff")
                .param("cutoff", clock.instant().minus(properties.retention()).atOffset(ZoneOffset.UTC))
                .update();
    }
}
