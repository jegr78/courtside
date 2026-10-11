package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class NotificationInbox {

    // The centre names what an entry concerns and nobody in it, so a player's id stays in the outbox.
    private static final Set<String> KEPT = Set.of(QueuedMessage.BOOKING, QueuedMessage.CLOSURE);
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final Clock clock;

    @Transactional(propagation = Propagation.MANDATORY)
    void record(UUID accountId, MessageKind kind, Map<String, String> parameters) {
        Map<String, String> kept = new TreeMap<>();
        parameters.forEach((name, value) -> {
            if (KEPT.contains(name)) kept.put(name, value);
        });
        jdbc.sql("""
                        INSERT INTO notification (id, account_id, kind, parameters, created_at)
                        VALUES (:id, :accountId, :kind, CAST(:parameters AS jsonb), :createdAt)
                        """)
                .param("id", UUID.randomUUID())
                .param("accountId", accountId)
                .param("kind", kind.name())
                .param("parameters", json.writeValueAsString(kept))
                .param("createdAt", Timestamp.from(clock.instant()))
                .update();
    }
}
