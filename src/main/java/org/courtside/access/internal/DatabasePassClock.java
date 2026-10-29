package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;

@Component
@RequiredArgsConstructor
class DatabasePassClock implements PassClock {

    private final JdbcClient jdbc;

    @Override
    public Instant now() {
        return jdbc.sql("SELECT statement_timestamp()").query(OffsetDateTime.class).single().toInstant();
    }
}
