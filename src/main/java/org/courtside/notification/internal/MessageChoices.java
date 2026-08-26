package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class MessageChoices {

    private final JdbcClient jdbc;

    // Nothing stored is a yes, so an account that never opened the page hears everything and a
    // kind added later reaches people who chose before it existed.
    @Transactional(readOnly = true)
    boolean wants(UUID accountId, MessageKind kind) {
        return !kind.isDeclinable() || jdbc.sql("""
                        SELECT count(*) FROM message_optout
                        WHERE user_account_id = :accountId AND kind = :kind
                        """)
                .param("accountId", accountId)
                .param("kind", kind.name())
                .query(Integer.class)
                .single() == 0;
    }

    @Transactional(readOnly = true)
    List<MessageKind> declinedBy(UUID accountId) {
        return jdbc.sql("SELECT kind FROM message_optout WHERE user_account_id = :accountId")
                .param("accountId", accountId)
                .query(String.class)
                .list().stream()
                .map(MessageKind::valueOf)
                .toList();
    }

    @Transactional
    void decline(UUID accountId, MessageKind kind) {
        jdbc.sql("""
                        INSERT INTO message_optout (user_account_id, kind) VALUES (:accountId, :kind)
                        ON CONFLICT DO NOTHING
                        """)
                .param("accountId", accountId)
                .param("kind", kind.name())
                .update();
    }

    @Transactional
    void accept(UUID accountId, MessageKind kind) {
        jdbc.sql("DELETE FROM message_optout WHERE user_account_id = :accountId AND kind = :kind")
                .param("accountId", accountId)
                .param("kind", kind.name())
                .update();
    }
}
