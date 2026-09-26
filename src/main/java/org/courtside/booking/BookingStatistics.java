package org.courtside.booking;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BookingStatistics {

    enum Granularity { WEEK, MONTH }

    record UtilisationTotals(long openMinutes, int courtCount, long capacityMinutes,
                             long closedMinutes, long bookedMinutes, Double occupancy) {
    }

    record CourtFigures(UUID courtId, int courtNumber, String courtName, boolean active,
                        long bookings, long closedMinutes, long bookedMinutes, Double occupancy) {
    }

    record CardFigures(UUID cardId, String label, String color, boolean closure, long bookings,
                       long minutes) {
    }

    record HourFigures(int isoWeekday, int hour, long openMinutes, long closedMinutes,
                       long bookedMinutes, Double occupancy) {
    }

    record Bucket(LocalDate startsOn, LocalDate endsOn, UtilisationTotals totals) {
    }

    record Utilisation(UtilisationTotals totals, List<CourtFigures> courts, List<CardFigures> cards,
                       List<HourFigures> hours, Granularity granularity, List<Bucket> buckets) {
    }

    record BookingFigures(long confirmed, long cancelled, Double cancellationRate, long series,
                          long single, long withGuests, long guestEntries) {
    }

    record ParticipantCardUse(UUID cardId, String label, long uses) {
    }

    Optional<LocalDate> firstBookingOn();

    Utilisation utilisation(LocalDate from, LocalDate to);

    UtilisationTotals utilisationTotals(LocalDate from, LocalDate to);

    BookingFigures bookingFigures(LocalDate from, LocalDate to);

    List<ParticipantCardUse> participantCardUses(LocalDate from, LocalDate to);

    long activeMembers(LocalDate from, LocalDate to);
}
