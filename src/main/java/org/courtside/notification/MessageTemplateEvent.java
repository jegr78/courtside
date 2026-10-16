package org.courtside.notification;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@NullMarked
public sealed interface MessageTemplateEvent extends DomainEventRecord {

    MessageKind kind();

    String language();

    // A template has no row id of its own, so its kind and language name it.
    @Override
    default UUID subjectId() {
        return UUID.nameUUIDFromBytes(("message-template:" + kind().name() + ":" + language())
                .getBytes(StandardCharsets.UTF_8));
    }

    record Changed(MessageKind kind, String language) implements MessageTemplateEvent {

        static final String TYPE = "notification.template.changed";

        @Override
        public String eventType() {
            return TYPE;
        }
    }

    record Reset(MessageKind kind, String language) implements MessageTemplateEvent {

        static final String TYPE = "notification.template.reset";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
