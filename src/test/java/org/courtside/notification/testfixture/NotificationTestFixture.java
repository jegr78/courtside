package org.courtside.notification.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;

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
}
