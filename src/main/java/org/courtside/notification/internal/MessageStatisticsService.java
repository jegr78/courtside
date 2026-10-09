package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;
import org.courtside.notification.MessageStatistics;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
class MessageStatisticsService implements MessageStatistics {

    private final JdbcClient jdbc;
    private final ClubTimeZone clubTimeZone;

    @Override
    public List<KindCount> queuedBetween(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            throw new IllegalStateException("Message counts need a resolved period");
        }
        Map<MessageKind, Map<MessageState, Long>> counts = new EnumMap<>(MessageKind.class);
        Map<MessageKind, Long> retried = new EnumMap<>(MessageKind.class);
        jdbc.sql("""
                        SELECT kind, state, COUNT(*) AS messages,
                               COUNT(*) FILTER (WHERE retries > 0) AS retried
                        FROM message_record
                        WHERE queued_at >= timezone(:zone, CAST(:from AS timestamp))
                          AND queued_at < timezone(:zone, CAST(:to AS timestamp) + interval '1 day')
                        GROUP BY kind, state
                        """)
                .param("zone", clubTimeZone.zoneId().getId())
                .param("from", from)
                .param("to", to)
                .query(rs -> {
                    MessageKind kind = MessageKind.valueOf(rs.getString("kind"));
                    counts.computeIfAbsent(kind, unused -> new EnumMap<>(MessageState.class))
                            .put(MessageState.valueOf(rs.getString("state")), rs.getLong("messages"));
                    retried.merge(kind, rs.getLong("retried"), Long::sum);
                });
        return Stream.of(MessageKind.values()).map(kind -> {
            Map<MessageState, Long> byState = counts.getOrDefault(kind, Map.of());
            return new KindCount(kind, byState.getOrDefault(MessageState.QUEUED, 0L),
                    byState.getOrDefault(MessageState.HANDED_OVER, 0L),
                    byState.getOrDefault(MessageState.REFUSED, 0L),
                    byState.getOrDefault(MessageState.FAILED, 0L),
                    retried.getOrDefault(kind, 0L));
        }).toList();
    }
}
