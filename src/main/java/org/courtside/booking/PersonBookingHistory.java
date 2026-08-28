package org.courtside.booking;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface PersonBookingHistory {

    record Reservation(UUID courtId, Instant startsAt, Instant endsAt) {
    }

    record Made(UUID bookingId, Instant createdAt, BookingStatus status, Instant cancelledAt,
                String note, List<Reservation> reservations) {

        public Made {
            reservations = List.copyOf(reservations);
        }
    }

    // Somebody else made this one: it has nowhere to put their note and nowhere to put the people
    // they played with, so leaving them out is not something a caller can forget.
    record Recorded(UUID bookingId, BookingStatus status, List<Reservation> reservations) {

        public Recorded {
            reservations = List.copyOf(reservations);
        }
    }

    record Series(UUID seriesId, Instant createdAt, LocalDate startsOn, LocalTime startTime,
                  int durationMinutes, int intervalWeeks, Set<DayOfWeek> weekdays,
                  LocalDate endsOn, Integer occurrenceCount, String note) {

        public Series {
            weekdays = Set.copyOf(weekdays);
        }
    }

    List<Made> madeBy(UUID accountId);

    List<Series> seriesCreatedBy(UUID accountId);

    List<Recorded> recordedIn(UUID personId);
}
