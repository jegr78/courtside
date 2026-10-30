package org.courtside.access;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

/** What happened to a booking's access grant; never its code. */
@NullMarked
public sealed interface AccessGrantEvent extends DomainEventRecord {

    UUID bookingId();

    @Override
    default UUID subjectId() {
        return bookingId();
    }

    /** A door accepted the grant's current code for the first time. */
    record Installed(UUID bookingId) implements AccessGrantEvent {

        static final String TYPE = "access.grant.installed";

        @Override
        public String eventType() {
            return TYPE;
        }
    }

    /** The grant was refused or reached five counted attempts. */
    record Failing(UUID bookingId) implements AccessGrantEvent {

        static final String TYPE = "access.grant.failing";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
