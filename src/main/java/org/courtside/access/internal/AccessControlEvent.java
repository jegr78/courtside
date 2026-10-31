package org.courtside.access.internal;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.UUID;

/** What a board asked of the access-control system as a whole. */
@NullMarked
public sealed interface AccessControlEvent extends DomainEventRecord {

    // The check concerns the connected system, so the entry names no single subject.
    @Override
    default @Nullable UUID subjectId() {
        return null;
    }

    /** A board asked for a connection check, which creates and deletes a user on the system. */
    record CheckRequested() implements AccessControlEvent {

        static final String TYPE = "access.control.checkRequested";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
