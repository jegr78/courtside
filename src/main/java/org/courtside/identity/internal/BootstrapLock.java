package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class BootstrapLock {

    private static final long LOCK_ID = 0x434F555254534944L;

    private final JdbcClient jdbc;

    void acquire() {
        // An empty table has no row to lock. This transaction-scoped PostgreSQL advisory lock
        // makes two application replicas serialize their first-start decision.
        jdbc.sql("SELECT pg_advisory_xact_lock(:id)")
                .param("id", LOCK_ID)
                .query((result, row) -> result.getObject(1))
                .single();
    }
}
