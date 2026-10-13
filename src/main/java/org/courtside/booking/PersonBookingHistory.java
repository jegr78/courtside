package org.courtside.booking;

import org.courtside.shared.CancellationReason;

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
                CancellationReason cancellationReason, String note, List<Reservation> reservations,
                Instant partnerSearchPublishedAt) {

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

    // The account's own entries, whatever became of them, until the sweep removes them with their slot.
    record Waiting(UUID entryId, UUID courtId, Instant startsAt, Instant endsAt, String state, Instant joinedAt,
                   Instant offerExpiresAt, String note) {
    }

    // An entry somebody else made naming this person as a player, without who made it.
    record NamedInWaitlist(UUID entryId, UUID courtId, Instant startsAt, Instant endsAt) {
    }

    List<Made> madeBy(UUID accountId);

    List<Waiting> waitlistOf(UUID accountId);

    List<NamedInWaitlist> namedInWaitlists(UUID personId);

    List<Series> seriesCreatedBy(UUID accountId);

    List<Recorded> recordedIn(UUID personId);
}
