package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageChannel;
import org.courtside.notification.MessageKind;
import org.courtside.notification.PersonMessageHistory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MessageHistoryService implements PersonMessageHistory {

    private final MessageRecordRepository records;
    private final JdbcClient jdbc;

    @Override
    public List<Message> sentTo(UUID accountId) {
        requireAccount(accountId);
        return records.findByAccountIdOrderByQueuedAtAscQueuedSeqAsc(accountId).stream()
                .map(record -> new Message(record.getQueuedAt(), record.getSettledAt(),
                        record.getKind(), record.getState(), record.getReason(),
                        record.getStatusCode(), record.getMessageId()))
                .toList();
    }

    @Override
    public List<Declined> declinedBy(UUID accountId) {
        requireAccount(accountId);
        return jdbc.sql("""
                        SELECT kind, created_at FROM message_optout
                        WHERE user_account_id = :accountId
                        ORDER BY created_at, kind
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new Declined(MessageKind.valueOf(rs.getString("kind")),
                        rs.getTimestamp("created_at").toInstant()))
                .list();
    }

    @Override
    public List<Notification> notificationsFor(UUID accountId) {
        requireAccount(accountId);
        return jdbc.sql("""
                        SELECT kind, created_at, read_at FROM notification
                        WHERE account_id = :accountId
                        ORDER BY created_seq
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new Notification(MessageKind.valueOf(rs.getString("kind")),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("read_at") == null ? null : rs.getTimestamp("read_at").toInstant()))
                .list();
    }

    @Override
    public List<DeclinedChannel> declinedChannelsBy(UUID accountId) {
        requireAccount(accountId);
        return jdbc.sql("""
                        SELECT channel, created_at FROM message_channel_optout
                        WHERE user_account_id = :accountId
                        ORDER BY created_at, channel
                        """)
                .param("accountId", accountId)
                .query((rs, row) -> new DeclinedChannel(MessageChannel.valueOf(rs.getString("channel")),
                        rs.getTimestamp("created_at").toInstant()))
                .list();
    }

    // Without the guard a missing account id would match every message this instance ever sent.
    private static void requireAccount(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A message history needs an account id");
        }
    }
}
