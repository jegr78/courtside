package org.courtside.booking;

import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.identity.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class BookingService {

    private final BookingWriter writer;
    private final CourtAllocationRepository allocations;
    private final BookingRepository bookings;

    public UUID create(CreateBookingCommand command) {
        try {
            return writer.write(command);
        } catch (ConcurrencyFailureException e) {
            // A deadlock leaves the transaction unusable; the retry runs in a fresh one, where the
            // competing row is committed and the exclusion constraint fires cleanly.
            return writer.write(command);
        }
    }

    public void cancel(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles) {
        writer.cancel(bookingId, cancelledBy, cancellerRoles);
    }

    @Transactional(readOnly = true)
    public List<CourtAllocation> allocationsBetween(Instant from, Instant to) {
        return allocations.findConfirmedStartingBetween(from, to);
    }

    @Transactional(readOnly = true)
    public Map<UUID, Long> participantCountsFor(Collection<UUID> bookingIds) {
        if (bookingIds.isEmpty()) {
            return Map.of();
        }
        return bookings.countParticipantsByBooking(bookingIds).stream()
                .collect(Collectors.toMap(row -> (UUID) row[0], row -> (Long) row[1]));
    }
}
