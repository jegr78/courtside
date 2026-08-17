package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class AdministratorLock {

    private static final long LOCK_ID = 0x4C41535441444D4EL;

    private final JdbcClient jdbc;

    public void acquire() {
        jdbc.sql("SELECT pg_advisory_xact_lock(:id)")
                .param("id", LOCK_ID)
                .query((result, row) -> result.getObject(1))
                .single();
    }
}
