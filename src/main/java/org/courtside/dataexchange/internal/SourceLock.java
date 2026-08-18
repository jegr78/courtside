package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class SourceLock {

    private static final int NAMESPACE = 0x494D5052;

    private final JdbcClient jdbc;

    public void acquire(UUID sourceId) {
        jdbc.sql("SELECT pg_advisory_xact_lock(:namespace, :source)")
                .param("namespace", NAMESPACE)
                .param("source", sourceId.hashCode())
                .query((result, row) -> result.getObject(1))
                .single();
    }
}
