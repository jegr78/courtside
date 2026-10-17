package org.courtside.operations.internal;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

// A gauge without evidence reads NaN, so a collector never mistakes a missing backup for a fresh one.
@Slf4j
@Component
class OperatorMeters {

    static final String PENDING_EVENTS = "courtside.events.pending";
    static final String BACKUP_AGE = "courtside.backup.age";

    private final JdbcClient jdbc;
    private final OperatorHealthService health;

    OperatorMeters(MeterRegistry meters, JdbcClient jdbc, OperatorHealthService health) {
        this.jdbc = jdbc;
        this.health = health;
        Gauge.builder(PENDING_EVENTS, this, OperatorMeters::pendingEvents)
                .description("Event publications between modules that have not completed")
                .strongReference(true)
                .register(meters);
        Gauge.builder(BACKUP_AGE, this, OperatorMeters::backupAge)
                .description("Seconds since the latest backup the operator recorded")
                .baseUnit("seconds")
                .strongReference(true)
                .register(meters);
    }

    private double pendingEvents() {
        try {
            return jdbc.sql("SELECT count(*) FROM event_publication WHERE completion_date IS NULL")
                    .query(Long.class).single();
        } catch (RuntimeException unreadable) {
            log.warn("Pending event publications could not be counted", unreadable);
            return Double.NaN;
        }
    }

    private double backupAge() {
        Long age = health.backup().ageSeconds();
        return age == null ? Double.NaN : age;
    }
}
