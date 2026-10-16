package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

@Component
@RequiredArgsConstructor
class MessageTemplateOverrides {

    private final JdbcClient jdbc;

    record Stored(MessageKind kind, String language, MessageText text) {
    }

    Optional<MessageText> of(MessageKind kind, String language) {
        return jdbc.sql("SELECT subject, body FROM message_template_override WHERE kind = :kind AND language = :language")
                .param("kind", kind.name())
                .param("language", language)
                .query((row, number) -> new MessageText(row.getString("subject"), row.getString("body")))
                .optional();
    }

    // A row stored for a kind this version no longer knows stays out of every answer.
    List<Stored> all() {
        return jdbc.sql("SELECT kind, language, subject, body FROM message_template_override")
                .query((row, number) -> {
                    String stored = row.getString("kind");
                    String language = row.getString("language");
                    MessageText text = new MessageText(row.getString("subject"), row.getString("body"));
                    return Arrays.stream(MessageKind.values())
                            .filter(kind -> kind.name().equals(stored))
                            .findFirst()
                            .map(kind -> new Stored(kind, language, text))
                            .orElse(null);
                })
                .list().stream()
                .filter(Objects::nonNull)
                .toList();
    }

    void store(MessageKind kind, String language, MessageText text, Instant now) {
        jdbc.sql("""
                        INSERT INTO message_template_override (kind, language, subject, body, changed_at)
                        VALUES (:kind, :language, :subject, :body, :now)
                        ON CONFLICT (kind, language)
                        DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, changed_at = EXCLUDED.changed_at
                        """)
                .param("kind", kind.name())
                .param("language", language)
                .param("subject", text.subject())
                .param("body", text.body())
                .param("now", Timestamp.from(now))
                .update();
    }

    boolean remove(MessageKind kind, String language) {
        return jdbc.sql("DELETE FROM message_template_override WHERE kind = :kind AND language = :language")
                .param("kind", kind.name())
                .param("language", language)
                .update() > 0;
    }
}
