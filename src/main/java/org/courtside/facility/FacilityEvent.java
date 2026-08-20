package org.courtside.facility;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

@NullMarked
public sealed interface FacilityEvent extends DomainEventRecord {

    record CourtAdded(UUID courtId, int number) implements FacilityEvent {

        static final String TYPE = "facility.court.added";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return courtId;
        }

    }

    record CourtChanged(UUID courtId, int number, List<String> changedFields) implements FacilityEvent {

        static final String TYPE = "facility.court.changed";

        public CourtChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return courtId;
        }

    }

    record CourtAvailabilityChanged(UUID courtId, boolean active) implements FacilityEvent {

        static final String TYPE = "facility.court.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return courtId;
        }

    }

    record OpeningHoursSet(UUID openingHoursId, int dayOfWeek, LocalTime opensAt, LocalTime closesAt)
            implements FacilityEvent {

        static final String TYPE = "facility.openingHours.set";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return openingHoursId;
        }

    }

    record OpeningHoursClosed(UUID openingHoursId, int dayOfWeek) implements FacilityEvent {

        static final String TYPE = "facility.openingHours.closed";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return openingHoursId;
        }

    }
}
