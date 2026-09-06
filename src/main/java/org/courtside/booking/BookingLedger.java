package org.courtside.booking;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

public interface BookingLedger {

    // No account and no member: this is the occupancy the day grid already shows anybody, read
    // over a period rather than one day at a time.
    record Occupancy(LocalDate date, LocalTime startsAt, LocalTime endsAt, int courtNumber,
                     String courtName, String card) {
    }

    List<Occupancy> confirmedBetween(LocalDate from, LocalDate to);
}
