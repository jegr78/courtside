package org.courtside.facility;

import java.time.LocalDate;
import java.util.UUID;

/** One court is closed from {@code startsOn} to {@code endsOn}, both inclusive. */
public record CourtClosure(UUID id, UUID courtId, String name, LocalDate startsOn, LocalDate endsOn) {

    public boolean covers(LocalDate date) {
        return !date.isBefore(startsOn) && !date.isAfter(endsOn);
    }
}
