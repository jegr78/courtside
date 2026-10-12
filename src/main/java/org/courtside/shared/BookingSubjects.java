package org.courtside.shared;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface BookingSubjects {

    // A series is described by its earliest occurrence; an id naming neither is left out.
    Map<UUID, BookingSubject> describe(Collection<UUID> subjectIds);

    record BookingSubject(List<UUID> courtIds, TimeSlot slot) {
        public BookingSubject {
            courtIds = List.copyOf(courtIds);
        }
    }
}
