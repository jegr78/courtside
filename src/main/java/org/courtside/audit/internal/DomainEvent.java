package org.courtside.audit.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "domain_event")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DomainEvent {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false)
    private String eventType;

    @Column(nullable = false, updatable = false)
    private UUID subjectId;

    @Column(updatable = false)
    private UUID actorAccountId;

    @Column(nullable = false, updatable = false)
    private Instant occurredAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, updatable = false)
    private String payload;

    DomainEvent(String eventType, UUID subjectId, UUID actorAccountId, Instant occurredAt, String payload) {
        this.id = UUID.randomUUID();
        this.eventType = eventType;
        this.subjectId = subjectId;
        this.actorAccountId = actorAccountId;
        this.occurredAt = occurredAt;
        this.payload = payload;
    }
}
