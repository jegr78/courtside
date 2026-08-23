package org.courtside.notification.internal;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

interface MessageRecordRepository extends JpaRepository<MessageRecord, UUID> {

    List<MessageRecord> findAllByIdIn(Collection<UUID> ids);

    List<MessageRecord> findByAccountIdInOrderByQueuedAtDescIdDesc(Collection<UUID> accountIds,
                                                                   Limit limit);

    @Query("""
            SELECT record.id FROM MessageRecord record
            WHERE (:restricted = FALSE OR record.accountId IN :accountIds)
              AND (:state IS NULL OR record.state = :state)
              AND (:unsettled = FALSE OR record.state IN (
                    org.courtside.notification.MessageState.REFUSED,
                    org.courtside.notification.MessageState.FAILED))
              AND (CAST(:from AS timestamp) IS NULL OR record.queuedAt >= :from)
              AND (CAST(:to AS timestamp) IS NULL OR record.queuedAt < :to)
              AND (CAST(:cursorQueuedAt AS timestamp) IS NULL
                   OR record.queuedAt < :cursorQueuedAt
                   OR (record.queuedAt = :cursorQueuedAt AND record.id < :cursorId))
            ORDER BY record.queuedAt DESC, record.id DESC
            """)
    List<UUID> findPage(@Param("restricted") boolean restricted,
                        @Param("accountIds") Collection<UUID> accountIds,
                        @Param("state") org.courtside.notification.MessageState state,
                        @Param("unsettled") boolean unsettled,
                        @Param("from") Instant from, @Param("to") Instant to,
                        @Param("cursorQueuedAt") Instant cursorQueuedAt,
                        @Param("cursorId") UUID cursorId, Limit limit);
}
