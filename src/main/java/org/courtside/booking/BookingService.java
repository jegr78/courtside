package org.courtside.booking;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.IdempotencyKeyRaceException;
import org.courtside.booking.internal.IdempotencyKeyReusedException;
import org.courtside.identity.Role;
import org.courtside.shared.CursorPage;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class BookingService {

    private static final int MAX_PAGE_SIZE = 100;

    private final BookingWriter writer;
    private final CourtAllocationRepository allocations;
    private final BookingRepository bookings;
    private final BookingRequestFingerprint fingerprints;
    private final MeterRegistry meters;

    public UUID create(CreateBookingCommand command) {
        try {
            try {
                return writer.write(command);
            } catch (ConcurrencyFailureException e) {
                // A deadlock leaves the transaction unusable.
                return writer.write(command);
            }
        } catch (BookingRulesViolatedException failure) {
            recordRejections(failure);
            throw failure;
        }
    }

    public UUID create(CreateBookingCommand command, String idempotencyKey) {
        validateIdempotencyKey(idempotencyKey);
        String fingerprint = fingerprints.of(command);
        try {
            try {
                return createIdempotently(command, idempotencyKey, fingerprint);
            } catch (ConcurrencyFailureException failure) {
                return createIdempotently(command, idempotencyKey, fingerprint);
            }
        } catch (BookingRulesViolatedException failure) {
            recordRejections(failure);
            throw failure;
        }
    }

    private UUID createIdempotently(CreateBookingCommand command, String idempotencyKey, String fingerprint) {
        return existingBooking(command.bookedBy(), idempotencyKey, fingerprint)
                .orElseGet(() -> createNew(command, idempotencyKey, fingerprint));
    }

    private void recordRejections(BookingRulesViolatedException failure) {
        failure.getViolations().forEach(violation -> meters
                .counter("courtside.bookings.rejected", "rule", violation.code())
                .increment());
    }

    private static void validateIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null
                || idempotencyKey.isEmpty()
                || idempotencyKey.length() > 128
                || idempotencyKey.chars().anyMatch(character -> character < '!' || character > '~')) {
            throw new IllegalStateException(
                    "The idempotency key must be 1 to 128 visible ASCII characters");
        }
    }

    private UUID createNew(CreateBookingCommand command, String idempotencyKey, String fingerprint) {
        try {
            return writer.write(command, idempotencyKey, fingerprint);
        } catch (IdempotencyKeyRaceException race) {
            return existingBooking(command.bookedBy(), idempotencyKey, fingerprint)
                    .orElseThrow(() -> new IllegalStateException(
                            "An idempotency conflict has no persisted booking", race));
        }
    }

    private Optional<UUID> existingBooking(UUID bookedBy, String idempotencyKey, String fingerprint) {
        return bookings.findByBookedByAndIdempotencyKey(bookedBy, idempotencyKey)
                .map(booking -> {
                    if (!fingerprint.equals(booking.getRequestFingerprint())) {
                        throw new IdempotencyKeyReusedException();
                    }
                    return booking.getId();
                });
    }

    public void cancel(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles) {
        writer.cancel(bookingId, cancelledBy, cancellerRoles);
    }

    @Transactional(readOnly = true)
    public List<CourtAllocation> allocationsBetween(Instant from, Instant to) {
        return allocations.findConfirmedStartingBetween(from, to);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PersonalBookingPage personalBookings(UUID bookedBy, UUID cursor, int limit) {
        validatePageLimit(limit);
        List<UUID> ids = bookings.findPersonalBookingIds(
                bookedBy, cursor, PageRequest.of(0, Math.addExact(limit, 1)));
        CursorPage.Result<Booking> page = CursorPage.of(ids, limit, bookings::findAllByIdIn, Booking::getId);
        return new PersonalBookingPage(page.items(), page.nextCursor());
    }

    private static void validatePageLimit(int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException(
                    "Personal booking page size must be between 1 and " + MAX_PAGE_SIZE);
        }
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
