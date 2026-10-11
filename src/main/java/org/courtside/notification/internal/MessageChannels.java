package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageChannel;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class MessageChannels {

    private final JdbcClient jdbc;

    @Transactional(readOnly = true)
    boolean wants(UUID accountId, MessageChannel channel) {
        return jdbc.sql("""
                        SELECT count(*) FROM message_channel_optout
                        WHERE user_account_id = :accountId AND channel = :channel
                        """)
                .param("accountId", accountId)
                .param("channel", channel.name())
                .query(Integer.class)
                .single() == 0;
    }

    @Transactional(readOnly = true)
    List<MessageChannel> declinedBy(UUID accountId) {
        return jdbc.sql("SELECT channel FROM message_channel_optout WHERE user_account_id = :accountId")
                .param("accountId", accountId)
                .query(String.class)
                .list().stream()
                .map(MessageChannel::valueOf)
                .toList();
    }

    @Transactional
    void decline(UUID accountId, MessageChannel channel) {
        jdbc.sql("""
                        INSERT INTO message_channel_optout (user_account_id, channel) VALUES (:accountId, :channel)
                        ON CONFLICT DO NOTHING
                        """)
                .param("accountId", accountId)
                .param("channel", channel.name())
                .update();
    }

    @Transactional
    void accept(UUID accountId, MessageChannel channel) {
        jdbc.sql("DELETE FROM message_channel_optout WHERE user_account_id = :accountId AND channel = :channel")
                .param("accountId", accountId)
                .param("channel", channel.name())
                .update();
    }
}
