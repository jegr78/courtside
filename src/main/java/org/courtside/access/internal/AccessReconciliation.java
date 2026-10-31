package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.access.AccessControlConnector;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/** Compares the grants the system lists with the rows, at most once an hour at the end of a pass. */
@Slf4j
@Component
@ConnectorSelected
class AccessReconciliation {

    private static final Duration EVERY = Duration.ofHours(1);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final PassClock clock;
    private final AccessControlConnector connector;
    private final CallRunner calls;
    private final AtomicReference<Instant> lastRunAt = new AtomicReference<>();

    AccessReconciliation(JdbcClient jdbc, PlatformTransactionManager transactionManager, PassClock clock,
                         AccessControlConnector connector, CallRunner calls) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
        this.connector = connector;
        this.calls = calls;
    }

    void runIfDue(PassLock lock) {
        Instant now = clock.now();
        Instant last = lastRunAt.get();
        if (last != null && now.isBefore(last.plus(EVERY))) {
            return;
        }
        lastRunAt.set(now);
        if (!lock.stillHeld()) {
            return;
        }
        switch (calls.run(connector::remoteGrantIds)) {
            case CallRunner.Result.Done<Optional<Set<UUID>>>(Optional<Set<UUID>> listed) when listed != null ->
                    listed.ifPresent(this::reconcile);
            case CallRunner.Result.Busy<Optional<Set<UUID>>> busy -> log.warn(
                    "The access reconciliation was skipped: the call thread is still occupied by an abandoned call");
            case CallRunner.Result.Unclear<Optional<Set<UUID>>>(Throwable cause) -> log.warn(
                    "The access reconciliation was skipped: {}", cause == null ? "no listing within the deadline"
                            : cause.getClass().getName() + ": " + ConnectorText.sanitized(cause.getMessage(), null));
            default -> log.warn("The access reconciliation was skipped: the listing answered nothing");
        }
    }

    private void reconcile(Set<UUID> listed) {
        UUID[] ids = listed.toArray(UUID[]::new);
        int[] marked = transactions.execute(status -> {
            Timestamp now = Timestamp.from(clock.now());
            int orphaned = jdbc.sql("""
                            UPDATE access_grant
                            SET remote = 'MAYBE', next_attempt_at = :now, exposed_until = coalesce(exposed_until, :now)
                            WHERE remote = 'NONE' AND (NOT wanted OR refused) AND id = ANY(:ids)
                            """)
                    .param("now", now).param("ids", ids).update();
            int missing = jdbc.sql("""
                            UPDATE access_grant SET remote = 'MAYBE', next_attempt_at = :now
                            WHERE remote = 'INSTALLED' AND NOT (id = ANY(:ids))
                            """)
                    .param("now", now).param("ids", ids).update();
            return new int[] {orphaned, missing};
        });
        if (marked != null && marked[0] + marked[1] > 0) {
            log.info("The access reconciliation marked {} listed and {} unlisted grants for another call",
                    marked[0], marked[1]);
        }
    }
}
