package org.courtside.booking;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

public interface BookingLedger {

    // No account and no member: this is the occupancy the day grid already shows anybody, read
    // over a period rather than one day at a time.
    record Occupancy(LocalDate date, LocalTime startsAt, LocalTime endsAt, int courtNumber,
                     String courtName, String card) {
    }

    List<Occupancy> confirmedBetween(LocalDate from, LocalDate to);

    record ChargedGuests(UUID personId, String currency, int guestPlaces, long sumMinor) {
    }

    record GuestFeeLedger(List<ChargedGuests> members, int unassignedGuestPlaces) {
    }

    // Confirmed bookings that started within the period and have ended, with a fee above zero.
    GuestFeeLedger chargedGuestsBetween(LocalDate from, LocalDate to);
}
