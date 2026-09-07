package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
class AgedSessionSweep {

    private final JdbcClient jdbc;
    private final SessionLifetimeProperties lifetime;

    // Spring Session deletes by expiry_time, which is built from the inactivity window alone, so a
    // session that died of age and was never used again would keep its row until that window passed.
    @Scheduled(cron = "${spring.session.jdbc.cleanup-cron}")
    @Transactional
    public void deleteSessionsPastTheirLifetime() {
        // The system clock, because creation_time is written from it.
        jdbc.sql("DELETE FROM spring_session WHERE creation_time <= :cutoff")
                .param("cutoff", System.currentTimeMillis() - lifetime.absoluteLifetime().toMillis())
                .update();
    }
}
