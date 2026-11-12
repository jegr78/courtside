package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ReadNotificationPolicy;
import org.courtside.shared.DatabaseDeadlines;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;

@Slf4j
@Service
@RequiredArgsConstructor
class ReadNotificationExpiry {

    private final DatabaseDeadlines deadlines;
    private final ReadNotificationPolicy policy;
    private final JdbcClient jdbc;
    private final Clock clock;

    @Transactional
    void deleteExpired() {
        deadlines.allowMaintenanceStatements();
        int deleted = jdbc.sql("DELETE FROM notification WHERE read_at < :cutoff")
                .param("cutoff", Timestamp.from(clock.instant().minus(policy.readNotificationPeriod().toDuration())))
                .update();
        if (deleted > 0) {
            log.info("Deleted {} read notifications past the club's period", deleted);
        }
    }
}
