package org.courtside.facility;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.LocalDate;
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

    /** From {@code effectiveFrom} until the day before {@code until}; a null bound is open. */
    record OpeningHoursSet(UUID openingHoursId, int dayOfWeek, LocalTime opensAt, LocalTime closesAt,
                           UUID versionId, @Nullable LocalDate effectiveFrom, @Nullable LocalDate until)
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

    /** From {@code effectiveFrom} until the day before {@code until}; a null bound is open. */
    record OpeningHoursClosed(@Nullable UUID openingHoursId, int dayOfWeek, UUID versionId,
                              @Nullable LocalDate effectiveFrom, @Nullable LocalDate until)
            implements FacilityEvent {

        static final String TYPE = "facility.openingHours.closed";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return versionId;
        }

    }
}
