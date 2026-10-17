package org.courtside.notification.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.util.List;
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

    public void declineEmail(UUID accountId) {
        jdbc.sql("INSERT INTO message_channel_optout (user_account_id, channel) VALUES (:accountId, 'EMAIL')")
                .param("accountId", accountId)
                .update();
    }

    public List<MessageKind> notificationsFor(UUID accountId) {
        return jdbc.sql("SELECT kind FROM notification WHERE account_id = :accountId ORDER BY created_seq")
                .param("accountId", accountId)
                .query(String.class)
                .list().stream()
                .map(MessageKind::valueOf)
                .toList();
    }

    public List<MessageKind> mailsQueuedFor(UUID accountId) {
        return jdbc.sql("SELECT kind FROM message_record WHERE account_id = :accountId ORDER BY queued_seq")
                .param("accountId", accountId)
                .query(String.class)
                .list().stream()
                .map(MessageKind::valueOf)
                .toList();
    }

    public UUID notify(UUID accountId, MessageKind kind, UUID bookingId, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :accountId, :kind, CAST(:parameters AS jsonb), :at)
                        """)
                .param("id", id)
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("parameters", bookingId == null ? "{}" : "{\"bookingId\": \"" + bookingId + "\"}")
                .param("at", java.sql.Timestamp.from(at))
                .update();
        return id;
    }

    public UUID notifyCancelled(UUID accountId, UUID bookingId, String reason, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :accountId, 'BOOKING_CANCELLED_BY_CLUB',
                                jsonb_build_object('bookingId', CAST(:bookingId AS text), 'reason', CAST(:reason AS text)),
                                :at)
                        """)
                .param("id", id)
                .param("accountId", accountId)
                .param("bookingId", bookingId.toString())
                .param("reason", reason)
                .param("at", java.sql.Timestamp.from(at))
                .update();
        return id;
    }

    public UUID notifyWaitlistOffered(UUID accountId, UUID entryId, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :accountId, 'WAITLIST_OFFER',
                                jsonb_build_object('waitlistEntryId', CAST(:entryId AS text)), :at)
                        """)
                .param("id", id)
                .param("accountId", accountId)
                .param("entryId", entryId.toString())
                .param("at", java.sql.Timestamp.from(at))
                .update();
        return id;
    }

    public UUID notifyDisplaced(UUID accountId, UUID bookingId, String closure, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :accountId, 'BOOKING_DISPLACED',
                                jsonb_build_object('bookingId', CAST(:bookingId AS text), 'closure', CAST(:closure AS text)),
                                :at)
                        """)
                .param("id", id)
                .param("accountId", accountId)
                .param("bookingId", bookingId.toString())
                .param("closure", closure)
                .param("at", java.sql.Timestamp.from(at))
                .update();
        return id;
    }

    public void markRead(UUID notificationId, Instant at) {
        jdbc.sql("UPDATE notification SET read_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(at))
                .param("id", notificationId)
                .update();
    }

    public Instant readAt(UUID notificationId) {
        java.sql.Timestamp read = jdbc.sql("SELECT read_at FROM notification WHERE id = :id")
                .param("id", notificationId)
                .query((rows, number) -> rows.getTimestamp(1))
                .list().getFirst();
        return read == null ? null : read.toInstant();
    }

    public void recordHandedOver(UUID accountId, MessageKind kind, String messageId, Instant at) {
        record(accountId, kind, "HANDED_OVER", messageId, at, null, null);
    }

    public void recordRefused(UUID accountId, MessageKind kind, String messageId, Instant at,
                              String reason, String statusCode) {
        record(accountId, kind, "REFUSED", messageId, at, reason, statusCode);
    }

    public void recordFailed(UUID accountId, MessageKind kind, String messageId, Instant at) {
        record(accountId, kind, "FAILED", messageId, at, "MailSendException", null);
    }

    public void queueRetry(UUID accountId, MessageKind kind, String messageId, Instant queuedAt, Instant due) {
        jdbc.sql("""
                        INSERT INTO message_record
                            (id, account_id, kind, state, message_id, queued_at, attempts, retries,
                             next_attempt_at)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, 1, 1, :due)
                        """)
                .param("id", UUID.randomUUID())
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("messageId", messageId)
                .param("at", java.sql.Timestamp.from(queuedAt))
                .param("due", java.sql.Timestamp.from(due))
                .update();
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
