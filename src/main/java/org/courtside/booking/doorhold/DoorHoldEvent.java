package org.courtside.booking.doorhold;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public sealed interface DoorHoldEvent extends DomainEventRecord {

    record Started(UUID bookingId, UUID holdId) implements DoorHoldEvent {

        static final String TYPE = "booking.doorHold.started";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record Ended(UUID bookingId, UUID holdId) implements DoorHoldEvent {

        static final String TYPE = "booking.doorHold.ended";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }
}
