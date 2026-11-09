package org.courtside.booking;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.CourtReservations;
import org.courtside.booking.internal.ParticipantKind;
import org.courtside.config.BookingGridCoordination;
import org.courtside.shared.BookingConfirmed;
import org.courtside.shared.ParticipantRecorded;
import org.courtside.shared.TimeSlot;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class PendingPaymentService implements PendingPayments {

    private final BookingRepository bookings;
    private final EntityManager entityManager;
    private final BookingGridCoordination bookingGridCoordination;
    private final CourtReservations reservations;
    private final ApplicationEventPublisher events;
    private final MeterRegistry meters;
    private final Clock clock;

    @Override
    @Transactional(readOnly = true)
    public Optional<PendingBooking> pending(UUID bookingId) {
        if (bookingId == null) {
            return Optional.empty();
        }
        return bookings.findWithAllocationsById(bookingId)
                .filter(booking -> booking.getStatus() == BookingStatus.PENDING_PAYMENT)
                .flatMap(booking -> booking.amount().flatMap(amount -> booking.paymentExpiresAt()
                        .flatMap(expiresAt -> startOf(booking).map(startsAt -> new PendingBooking(booking.getId(),
                                booking.getBookedBy(), amount.minor(), amount.currency(), expiresAt, startsAt)))));
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public ConfirmOutcome confirm(UUID bookingId) {
        // The grid lock comes first, as on every cancellation, so the two never wait on each other's rows.
        bookingGridCoordination.lock();
        if (bookingId == null || bookings.lockById(bookingId).isEmpty()) {
            return ConfirmOutcome.NOT_PENDING;
        }
        entityManager.clear();
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        if (booking.getStatus() == BookingStatus.PENDING_PAYMENT
                && startOf(booking).filter(start -> !start.isBefore(clock.instant())).isEmpty()) {
            releaseLocked(booking, null);
            return ConfirmOutcome.NOT_PENDING;
        }
        if (!booking.confirmPayment()) {
            return booking.getStatus() == BookingStatus.CONFIRMED && booking.paymentExpiresAt().isPresent()
                    ? ConfirmOutcome.ALREADY_CONFIRMED : ConfirmOutcome.NOT_PENDING;
        }
        bookings.saveAndFlush(booking);
        announceConfirmed(booking);
        return ConfirmOutcome.CONFIRMED;
    }

    @Override
    @Transactional
    public boolean release(UUID bookingId) {
        bookingGridCoordination.lock();
        if (bookingId == null || bookings.lockById(bookingId).isEmpty()) {
            return false;
        }
        entityManager.clear();
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        return releaseLocked(booking, null);
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> pendingSince(Instant before) {
        if (before == null) {
            throw new IllegalStateException("The instant pending bookings were written before is required");
        }
        return bookings.findPendingCreatedBefore(before);
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> expiredAt(Instant now) {
        if (now == null) {
            throw new IllegalStateException("The instant holds expire at is required");
        }
        return bookings.findPendingExpiredAt(now);
    }

    /** Ends the hold of a booking whose row the caller has locked; false when it no longer awaits payment. */
    boolean releaseLocked(Booking booking, UUID releasedBy) {
        if (!booking.expirePayment(clock.instant(), releasedBy)) {
            return false;
        }
        bookings.saveAndFlush(booking);
        releaseCourtsOf(booking);
        events.publishEvent(new BookingPaymentExpired(booking.getId(), booking.getBookedBy()));
        return true;
    }

    void releaseCourtsOf(Booking booking) {
        booking.getAllocations().stream()
                .collect(Collectors.groupingBy(allocation -> new TimeSlot(allocation.getStartsAt(), allocation.getEndsAt()),
                        Collectors.mapping(CourtAllocation::getCourtId, Collectors.toList())))
                .forEach((slot, courtIds) -> reservations.released(courtIds, slot));
    }

    private static Optional<Instant> startOf(Booking booking) {
        return booking.getAllocations().stream().map(CourtAllocation::getStartsAt).min(Instant::compareTo);
    }

    void countCreatedOnCommit() {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                meters.counter("courtside.bookings.created").increment();
            }
        });
    }

    private void announceConfirmed(Booking booking) {
        countCreatedOnCommit();
        events.publishEvent(new BookingConfirmed(booking.getId()));
        // The first participant is the booker, whom a confirmation already tells.
        booking.getParticipants().stream()
                .skip(1)
                .filter(participant -> participant.getKind() == ParticipantKind.MEMBER)
                .map(BookingParticipant::getPersonId)
                .filter(Objects::nonNull)
                .forEach(personId -> events.publishEvent(new ParticipantRecorded(booking.getId(), personId)));
    }
}
