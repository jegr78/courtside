package org.courtside.notification.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "message_record")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class MessageRecord {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false)
    private UUID accountId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private MessageKind kind;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MessageState state;

    @Column(nullable = false, updatable = false)
    private String messageId;

    private String reason;

    private String statusCode;

    @Column(nullable = false, updatable = false)
    private Instant queuedAt;

    @Column(insertable = false, updatable = false, nullable = false)
    private Long queuedSeq;

    private Instant settledAt;

    MessageRecord(UUID accountId, MessageKind kind, String messageId, Instant queuedAt) {
        this.id = UUID.randomUUID();
        this.accountId = accountId;
        this.kind = kind;
        this.messageId = messageId;
        this.state = MessageState.QUEUED;
        this.queuedAt = queuedAt;
    }

    void handedOver(Instant at) {
        settle(MessageState.HANDED_OVER, at, null, null);
    }

    void refused(Instant at, String reason, String statusCode) {
        settle(MessageState.REFUSED, at, reason, statusCode);
    }

    void failed(Instant at, String reason) {
        settle(MessageState.FAILED, at, reason, null);
    }

    private void settle(MessageState settled, Instant at, String reason, String statusCode) {
        this.state = settled;
        this.settledAt = at;
        this.reason = reason;
        this.statusCode = statusCode;
    }
}
