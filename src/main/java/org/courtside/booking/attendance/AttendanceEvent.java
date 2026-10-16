package org.courtside.booking.attendance;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.UUID;

@NullMarked
public sealed interface AttendanceEvent extends DomainEventRecord {

    record Recorded(UUID bookingId, AttendanceOutcome outcome) implements AttendanceEvent {

        static final String TYPE = "booking.attendance.recorded";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record Cleared(UUID bookingId) implements AttendanceEvent {

        static final String TYPE = "booking.attendance.cleared";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record NoShowsLifted(UUID personId, UUID accountId, int lifted) implements AttendanceEvent {

        static final String TYPE = "booking.attendance.noShowsLifted";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record PolicyChanged(UUID policyId, boolean enabled, @Nullable Integer releaseAfterMinutes,
                         List<String> changedFields) implements AttendanceEvent {

        static final String TYPE = "booking.attendance.policyChanged";

        public PolicyChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return policyId;
        }
    }
}
