package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;

import java.util.Map;
import java.util.UUID;

record QueuedMessage(UUID accountId, MessageKind kind, Map<String, String> parameters) {

    static final String BOOKING = "bookingId";
    static final String CLOSURE = "closure";
    static final String PLAYER = "playerId";

    QueuedMessage {
        parameters = parameters == null ? Map.of() : Map.copyOf(parameters);
    }

    UUID booking() {
        return id(BOOKING);
    }

    UUID player() {
        return id(PLAYER);
    }

    String closure() {
        return required(CLOSURE);
    }

    private UUID id(String name) {
        String value = required(name);
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException malformed) {
            throw new MessageUndeliverableException("ParameterMalformed");
        }
    }

    private String required(String name) {
        String value = parameters.get(name);
        if (value == null) {
            throw new MessageUndeliverableException("ParameterMissing");
        }
        return value;
    }
}
