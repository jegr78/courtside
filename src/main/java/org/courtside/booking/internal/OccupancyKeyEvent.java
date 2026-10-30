package org.courtside.booking.internal;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.UUID;

/** A board created or revoked the occupancy key; never the key or its hash. */
@NullMarked
public sealed interface OccupancyKeyEvent extends DomainEventRecord {

    // The key belongs to the instance, so the entry concerns no single subject.
    @Override
    default @Nullable UUID subjectId() {
        return null;
    }

    record Created() implements OccupancyKeyEvent {

        static final String TYPE = "booking.occupancyKey.created";

        @Override
        public String eventType() {
            return TYPE;
        }
    }

    record Revoked() implements OccupancyKeyEvent {

        static final String TYPE = "booking.occupancyKey.revoked";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
