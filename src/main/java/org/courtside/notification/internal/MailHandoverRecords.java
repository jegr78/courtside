package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MailHandover;
import org.courtside.notification.MessageState;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Optional;

@Component
@RequiredArgsConstructor
class MailHandoverRecords implements MailHandover {

    private final JdbcClient jdbc;
    private final MailProperties mail;

    @Override
    @Transactional(readOnly = true)
    public Observation observe() {
        return new Observation(
                latestSettled(MessageState.HANDED_OVER),
                latestSettled(MessageState.FAILED),
                jdbc.sql("SELECT EXISTS (SELECT 1 FROM message_record WHERE state = :queued AND retries > 0)")
                        .param("queued", MessageState.QUEUED.name())
                        .query(Boolean.class).single(),
                mail.host() + ":" + mail.port());
    }

    private Optional<Instant> latestSettled(MessageState state) {
        return jdbc.sql("SELECT settled_at FROM message_record WHERE state = :state ORDER BY queued_seq DESC LIMIT 1")
                .param("state", state.name())
                .query(OffsetDateTime.class).optional()
                .map(OffsetDateTime::toInstant);
    }
}
