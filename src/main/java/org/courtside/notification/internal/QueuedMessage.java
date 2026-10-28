package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.courtside.shared.CancellationReason;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

record QueuedMessage(UUID accountId, MessageKind kind, Map<String, String> parameters, String previousAddress) {

    static final String BOOKING = "bookingId";
    static final String CLOSURE = "closure";
    static final String PLAYER = "playerId";
    static final String SERIES = "seriesId";
    static final String REASON = "reason";
    static final String BOOKINGS = "bookingIds";
    static final String PREVIOUS_STARTS_AT = "previousStartsAt";
    static final String PREVIOUS_ENDS_AT = "previousEndsAt";
    static final String PREVIOUS_COURTS = "previousCourtIds";
    static final String WAITLIST_ENTRY = "waitlistEntryId";

    QueuedMessage {
        parameters = parameters == null ? Map.of() : Map.copyOf(parameters);
    }

    QueuedMessage(UUID accountId, MessageKind kind, Map<String, String> parameters) {
        this(accountId, kind, parameters, null);
    }

    UUID booking() {
        return id(BOOKING);
    }

    UUID player() {
        return id(PLAYER);
    }

    UUID series() {
        return id(SERIES);
    }

    UUID waitlistEntry() {
        return id(WAITLIST_ENTRY);
    }

    Optional<CancellationReason> reason() {
        String stored = parameters.get(REASON);
        if (stored == null) {
            return Optional.empty();
        }
        CancellationReason reason = StoredCancellationReasons.of(stored);
        if (reason == null) {
            throw new MessageUndeliverableException("ParameterMalformed");
        }
        return Optional.of(reason);
    }

    List<UUID> bookings() {
        return ids(BOOKINGS);
    }

    List<UUID> previousCourts() {
        return ids(PREVIOUS_COURTS);
    }

    private List<UUID> ids(String name) {
        return Arrays.stream(required(name).split(",")).map(QueuedMessage::uuid).toList();
    }

    Instant previousStartsAt() {
        return instant(PREVIOUS_STARTS_AT);
    }

    Instant previousEndsAt() {
        return instant(PREVIOUS_ENDS_AT);
    }

    String closure() {
        return required(CLOSURE);
    }

    private UUID id(String name) {
        return uuid(required(name));
    }

    private static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException malformed) {
            throw new MessageUndeliverableException("ParameterMalformed");
        }
    }

    private Instant instant(String name) {
        try {
            return Instant.parse(required(name));
        } catch (DateTimeParseException malformed) {
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
