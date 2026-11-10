package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// What was closed, not what the booking is: the message reads the booking when it is written, so
// the record says a court went out of service without saying who was on it.
@NullMarked
public record BookingDisplaced(UUID bookingId, Closure closure, boolean cancelled) implements DomainEventRecord {

    static final String TYPE = "booking.booking.displaced";

    public BookingDisplaced(UUID bookingId, Closure closure) {
        this(bookingId, closure, false);
    }

    public enum Closure {
        COURT_OUT_OF_SERVICE,
        CARD_OUT_OF_SERVICE,
        DAY_CLOSED,
        HOURS_NARROWED,
        HOLIDAY,
        SEASON,
        COURT_CLOSED
    }

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return bookingId;
    }
}
