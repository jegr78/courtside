package org.courtside.booking;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.EntityManager;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingAccessControl;
import org.courtside.booking.internal.BookingDrafts;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CourtReservations;
import org.courtside.booking.internal.CancellationReasonNotAllowedException;
import org.courtside.booking.internal.CardEligibilityPolicy;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.ParticipantKind;
import org.courtside.booking.internal.ParticipantCardCapacity;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.booking.internal.SeriesOccurrenceCancellation;
import org.courtside.booking.internal.IdempotencyKeyRaceException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.facility.FacilityService;
import org.courtside.config.BookingGridCoordination;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.BookingCancelled;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.BookingConfirmed;
import org.courtside.shared.ParticipantRecorded;
import org.courtside.shared.SqlConstraintViolation;
import org.courtside.shared.TimeSlot;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Component
@RequiredArgsConstructor
@Transactional
class BookingWriter implements SeriesOccurrenceCancellation, BookingDrafts {

    private static final String OVERLAP_CONSTRAINT = "court_allocation_no_overlap";
    private static final String IDEMPOTENCY_CONSTRAINT = "booking_idempotency_by_account";

    private final BookingRepository bookings;
    private final CourtAllocationRepository allocations;
    private final EntityManager entityManager;
    private final Clock clock;
    private final BookingRuleGate ruleGate;
    private final BookingAccessControl accessControl;
    private final CardService cards;
    private final CardEligibilityPolicy cardEligibility;
    private final FacilityService facility;
    private final PersonRepository personRepository;
    private final ParticipantCardCapacity participantCardCapacity;
    private final BookingGridCoordination bookingGridCoordination;
    private final MeterRegistry meters;
    private final ApplicationEventPublisher events;
    private final CourtReservations reservations;

    @Override
    public UUID write(CreateBookingCommand command) {
        return write(command, null, null);
    }

    @Override
    public void requireBookable(CreateBookingCommand command) {
        bookable(command);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY, noRollbackFor = DomainFailure.class)
    public boolean isBookable(CreateBookingCommand command) {
        if (!facility.findUnbookableCourts(command.courtIds()).isEmpty()) {
            return false;
        }
        try {
            bookable(command);
            return true;
        } catch (DomainFailure refused) {
            return false;
        }
    }

    private List<ParticipantSpec> bookable(CreateBookingCommand command) {
        facility.requireBookableCourts(command.courtIds());
        BookingCard card = cardEligibility.requireEligible(command.cardId(), command.callerRoles());
        List<ParticipantSpec> slots = resolveSlots(card, command);
        ruleGate.requireNoViolations(new BookingRuleCheck(command.courtIds(), command.cardId(), command.slot(),
                command.bookedBy(), command.bookedByPersonId(), command.callerRoles()));
        return slots;
    }

    UUID write(CreateBookingCommand command, String idempotencyKey, String requestFingerprint) {
        bookingGridCoordination.lock();
        List<ParticipantSpec> slots = bookable(command);
        if (CourtReservations.overriddenBy(command.callerRoles(), command.cardId())) {
            reservations.withdrawFor(command.courtIds(), command.slot(), command.bookedBy());
        } else {
            reservations.requireUnreserved(command.courtIds(), command.slot(), command.bookedBy());
        }
        requireAvailableCourts(command, idempotencyKey);

        Booking booking = new Booking(
                command.cardId(), command.bookedBy(), command.note(), clock.instant());
        command.courtIds().forEach(courtId -> booking.allocate(courtId, command.slot()));
        slots.forEach(booking::addParticipant);
        booking.joinSeries(command.seriesId());
        booking.identifyRequest(idempotencyKey, requestFingerprint);

        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException e) {
            if (isOverlap(e)) {
                throw courtUnavailable(e);
            }
            if (isConstraint(e, IDEMPOTENCY_CONSTRAINT)) {
                throw new IdempotencyKeyRaceException(e);
            }
            throw e;
        }
        reservations.booked(command.bookedBy(), booking.getId(), command.courtIds(), command.slot());
        countCreatedOnCommit();
        // A series is one decision and gets one message of its own, not one per occurrence.
        if (command.seriesId() == null) {
            events.publishEvent(new BookingConfirmed(booking.getId()));
            announceRecordedMembers(booking.getId(), command);
        }
        return booking.getId();
    }

    private void countCreatedOnCommit() {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                meters.counter("courtside.bookings.created").increment();
            }
        });
    }

    private void requireAvailableCourts(CreateBookingCommand command, String idempotencyKey) {
        if (!allocations.existsConfirmedOverlapping(command.courtIds(), command.slot().start(), command.slot().end())) {
            return;
        }
        if (idempotencyKey != null
                && bookings.findByBookedByAndIdempotencyKey(command.bookedBy(), idempotencyKey).isPresent()) {
            throw new IdempotencyKeyRaceException(null);
        }
        throw courtUnavailable(null);
    }

    private CourtUnavailableException courtUnavailable(Throwable cause) {
        meters.counter("courtside.bookings.conflicts").increment();
        return new CourtUnavailableException("One of the requested courts is already occupied for that time", cause);
    }

    private void announceRecordedMembers(UUID bookingId, CreateBookingCommand command) {
        command.participants().stream()
                .filter(slot -> slot.kind() == ParticipantKind.MEMBER)
                .map(ParticipantSpec::personId)
                .forEach(personId ->
                        events.publishEvent(new ParticipantRecorded(bookingId, personId)));
    }

    void cancel(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles, CancellationReason reason) {
        if (cancelBooking(bookingId, cancelledBy, cancellerRoles, reason)) {
            events.publishEvent(new BookingCancelled(bookingId, cancelledBy, reason));
        }
    }

    @Override
    public void cancelOccurrence(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles,
                                 CancellationReason reason) {
        cancelBooking(bookingId, cancelledBy, cancellerRoles, reason);
    }

    private boolean cancelBooking(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles,
                                  CancellationReason reason) {
        bookingGridCoordination.lock();
        bookings.lockById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        entityManager.clear();
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        accessControl.requireManagementAccess(booking, cancelledBy, cancellerRoles);
        if (reason != null && cancelledBy.equals(booking.getBookedBy())) {
            throw new CancellationReasonNotAllowedException();
        }
        Instant cancelledAt = clock.instant();
        try {
            ruleGate.requireCancellationAllowed(booking, cancellerRoles, cancelledAt);
        } catch (BookingRulesViolatedException failure) {
            failure.getViolations().forEach(violation -> meters
                    .counter("courtside.bookings.rejected", "rule", violation.code())
                    .increment());
            throw failure;
        }
        boolean changed = booking.cancel(cancelledBy, cancelledAt, reason);
        bookings.saveAndFlush(booking);
        if (changed) {
            releaseCourtsOf(booking);
        }
        return changed;
    }

    private void releaseCourtsOf(Booking booking) {
        booking.getAllocations().stream()
                .collect(Collectors.groupingBy(allocation -> new TimeSlot(allocation.getStartsAt(), allocation.getEndsAt()),
                        Collectors.mapping(CourtAllocation::getCourtId, Collectors.toList())))
                .forEach((slot, courtIds) -> reservations.released(courtIds, slot));
    }

    private boolean isOverlap(DataIntegrityViolationException e) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.EXCLUSION_VIOLATION, OVERLAP_CONSTRAINT);
    }

    private boolean isConstraint(DataIntegrityViolationException e, String constraint) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.UNIQUE_VIOLATION, constraint);
    }

    private List<ParticipantSpec> resolveSlots(BookingCard card, CreateBookingCommand command) {
        if (!card.tracksPlayers()) {
            if (!command.participants().isEmpty()) {
                throw new ParticipantsInvalidException("booking.participants.notTracked",
                        Map.of("cardLabel", card.getLabel()));
            }
            return List.of();
        }

        if (command.bookedByPersonId() == null) {
            throw new ParticipantsInvalidException("booking.participants.bookerUnknown", Map.of());
        }

        List<ParticipantSpec> slots = new ArrayList<>();
        slots.add(ParticipantSpec.member(command.bookedByPersonId()));
        slots.addAll(command.participants());

        long distinctPersons = slots.stream()
                .map(ParticipantSpec::personId)
                .filter(Objects::nonNull)
                .distinct()
                .count();
        long persons = slots.stream().filter(slot -> slot.personId() != null).count();
        if (distinctPersons != persons) {
            throw new ParticipantsInvalidException("booking.participants.duplicate", Map.of());
        }

        if (!card.allows(slots.size())) {
            throw new ParticipantsInvalidException("booking.participants.slotCount",
                    Map.of("cardLabel", card.getLabel(),
                           "actual", slots.size(),
                           "allowed", allowedAsText(card)));
        }

        for (ParticipantSpec slot : slots) {
            if (slot.kind() == ParticipantKind.GUEST && !card.isGuestAllowed()) {
                throw new ParticipantsInvalidException("booking.participants.guestNotAllowed",
                        Map.of("cardLabel", card.getLabel()));
            }
            if (slot.kind() == ParticipantKind.CARD && !isBookableCard(slot.cardId())) {
                throw new ParticipantsInvalidException("booking.participants.unknownCard",
                        Map.of());
            }
            if (slot.kind() == ParticipantKind.MEMBER && !personRepository.existsById(slot.personId())) {
                throw new ParticipantsInvalidException("booking.participants.unknownPerson",
                        Map.of());
            }
        }

        participantCardCapacity.requireAvailableForSpecs(slots, command.slot());

        return slots;
    }

    private boolean isBookableCard(UUID participantCardId) {
        return cards.findParticipantCard(participantCardId)
                .filter(ParticipantCard::isActive)
                .isPresent();
    }

    private String allowedAsText(BookingCard card) {
        return IntStream.range(0, card.getAllowedPlayerCounts().length)
                .mapToObj(i -> String.valueOf(card.getAllowedPlayerCounts()[i]))
                .collect(Collectors.joining(" / "));
    }
}
