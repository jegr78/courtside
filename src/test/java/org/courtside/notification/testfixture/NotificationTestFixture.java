package org.courtside.notification.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.util.UUID;

@RequiredArgsConstructor
public class NotificationTestFixture {

    private final JdbcClient jdbc;

    public void decline(UUID accountId, MessageKind kind) {
        jdbc.sql("INSERT INTO message_optout (user_account_id, kind) VALUES (:accountId, :kind)")
                .param("accountId", accountId)
                .param("kind", kind.name())
                .update();
    }

    public void recordHandedOver(UUID accountId, MessageKind kind, String messageId, Instant at) {
        record(accountId, kind, "HANDED_OVER", messageId, at, null, null);
    }

    public void recordRefused(UUID accountId, MessageKind kind, String messageId, Instant at,
                              String reason, String statusCode) {
        record(accountId, kind, "REFUSED", messageId, at, reason, statusCode);
    }

    private void record(UUID accountId, MessageKind kind, String state, String messageId,
                        Instant at, String reason, String statusCode) {
        jdbc.sql("""
                        INSERT INTO message_record
                            (id, account_id, kind, state, message_id, reason, status_code,
                             queued_at, settled_at)
                        VALUES (:id, :accountId, :kind, :state, :messageId, :reason, :statusCode,
                                :at, :at)
                        """)
                .param("id", UUID.randomUUID())
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("state", state)
                .param("messageId", messageId)
                .param("reason", reason)
                .param("statusCode", statusCode)
                .param("at", java.sql.Timestamp.from(at))
                .update();
    }
}
