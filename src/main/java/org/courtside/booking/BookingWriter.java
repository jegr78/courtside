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
import org.courtside.booking.internal.DisplacedPayments;
import org.courtside.booking.internal.StandingDisplacement;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.ParticipantKind;
import org.courtside.booking.internal.ParticipantCardCapacity;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.booking.internal.SeriesOccurrenceCancellation;
import org.courtside.booking.internal.UnattendedRelease;
import org.courtside.booking.internal.IdempotencyKeyRaceException;
import org.courtside.booking.internal.PendingPaymentRaceException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.ClubCurrency;
import org.courtside.card.ParticipantCard;
import org.courtside.credit.BookingPayments;
import org.courtside.facility.FacilityService;
import org.courtside.config.BookingGridCoordination;
import org.courtside.identity.AccountAnonymisedException;
import org.courtside.identity.Outsiders;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.BookingCancelled;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.BookingConfirmed;
import org.courtside.shared.ParticipantRecorded;
import org.courtside.shared.SqlConstraintViolation;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Component
@RequiredArgsConstructor
@Transactional
class BookingWriter implements SeriesOccurrenceCancellation, BookingDrafts, UnattendedRelease, DisplacedPayments {

    private static final String OVERLAP_CONSTRAINT = "court_allocation_no_overlap";
    private static final String IDEMPOTENCY_CONSTRAINT = "booking_idempotency_by_account";
    private static final String PENDING_CONSTRAINT = "booking_one_pending_per_account";
    private static final Duration PAYMENT_HOLD = Duration.ofMinutes(15);

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
    private final UserAccountRepository accounts;
    private final Outsiders outsiders;
    private final ParticipantCardCapacity participantCardCapacity;
    private final BookingGridCoordination bookingGridCoordination;
    private final MeterRegistry meters;
    private final ApplicationEventPublisher events;
    private final CourtReservations reservations;
    private final ClubCurrency currency;
    private final BookingPayments payments;
    private final PaymentMethods paymentMethods;
    private final PendingPaymentService pendingPayments;
    private final StandingDisplacement standingDisplacement;

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
        if (!cardEligibility.admits(command.cardId(), command.bookedBy(), command.callerRoles())) {
            return false;
        }
        try {
            checked(cardEligibility.requireActive(command.cardId()), command);
            return true;
        } catch (DomainFailure refused) {
            return false;
        }
    }

    private List<ParticipantSpec> bookable(CreateBookingCommand command) {
        facility.requireBookableCourts(command.courtIds());
        return checked(cardEligibility.requireEligible(command.cardId(), command.bookedBy(), command.callerRoles()), command);
    }

    private List<ParticipantSpec> checked(BookingCard card, CreateBookingCommand command) {
        List<ParticipantSpec> slots = resolveSlots(card, command);
        ruleGate.requireNoViolations(new BookingRuleCheck(command.courtIds(), command.cardId(), command.slot(),
                command.bookedBy(), command.bookedByPersonId(), command.callerRoles()));
        return slots;
    }

    UUID write(CreateBookingCommand command, String idempotencyKey, String requestFingerprint) {
        bookingGridCoordination.lock();
        if (accounts.lockClosedFlag(command.bookedBy()).orElse(false)) {
            throw new AccountAnonymisedException();
        }
        List<ParticipantSpec> slots = bookable(command);
        if (CourtReservations.overriddenBy(command.callerRoles(), command.cardId(), true)) {
            reservations.withdrawFor(command.courtIds(), command.slot(), command.bookedBy());
        } else {
            reservations.requireUnreserved(command.courtIds(), command.slot(), command.bookedBy());
        }
        requireAvailableCourts(command, idempotencyKey);

        Booking booking = new Booking(
                command.cardId(), command.bookedBy(), command.note(), clock.instant());
        command.courtIds().forEach(courtId -> booking.allocate(courtId, command.slot()));
        BookingCard card = cards.findCard(command.cardId()).orElseThrow();
        GuestFee guestFee = new GuestFee(card.getGuestFeeMinor(), currency.currency());
        slots.forEach(slot -> booking.addParticipant(slot, guestFee));
        if (outsiders.isOutsider(command.bookedBy(), command.callerRoles())) {
            booking.charge(BookingAmount.forDuration(card.getExternalPriceMinor() * command.courtIds().size(),
                    command.slot().duration(), currency.currency()));
        }
        booking.joinSeries(command.seriesId());
        booking.identifyRequest(idempotencyKey, requestFingerprint);
        booking.actedOnBehalfBy(command.actedBy());

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
        Optional<BookingAmount> amount = booking.amount().filter(charged -> charged.minor() > 0);
        boolean awaitingPayment = amount.isPresent() && !payFromCredit(command, booking, amount.get());
        reservations.booked(command.bookedBy(), booking.getId(), command.courtIds(), command.slot());
        if (awaitingPayment) {
            return booking.getId();
        }
        pendingPayments.countCreatedOnCommit();
        // A series is one decision and gets one message of its own, not one per occurrence.
        if (command.seriesId() == null) {
            events.publishEvent(new BookingConfirmed(booking.getId()));
            announceRecordedMembers(booking.getId(), command);
        }
        return booking.getId();
    }

    /** Debits the amount, or holds the court for a PayPal payment and answers false. */
    private boolean payFromCredit(CreateBookingCommand command, Booking booking, BookingAmount amount) {
        BookingPayments.BookingDebit debit = payments.debit(command.bookedBy(), booking.getId(), amount.minor(),
                amount.currency());
        if (debit.covered()) {
            return true;
        }
        if (command.actedBy() != null || command.seriesId() != null || !paymentMethods.payPalAvailable()) {
            throw new BookingRulesViolatedException(List.of(new RuleViolation("booking.payment.creditInsufficient",
                    Map.of("amountMinor", amount.minor(), "balanceMinor", debit.balanceMinor(),
                            "currency", debit.currency()))));
        }
        bookings.findPendingExpiryOf(command.bookedBy()).ifPresent(expiresAt -> {
            throw new BookingRulesViolatedException(List.of(new RuleViolation("booking.payment.pendingExists",
                    Map.of("expiresAt", expiresAt.toString()))));
        });
        Instant held = booking.getCreatedAt().plus(PAYMENT_HOLD);
        booking.awaitPayment(held.isBefore(command.slot().start()) ? held : command.slot().start());
        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException e) {
            if (isConstraint(e, PENDING_CONSTRAINT)) {
                throw new PendingPaymentRaceException(e);
            }
            throw e;
        }
        return false;
    }

    private void requireAvailableCourts(CreateBookingCommand command, String idempotencyKey) {
        if (!allocations.existsOccupyingOverlapping(command.courtIds(), command.slot().start(), command.slot().end())) {
            return;
        }
        if (idempotencyKey != null
                && bookings.findIdempotentRequest(command.bookedBy(), command.actedBy(), idempotencyKey).isPresent()) {
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
        if (reason == CancellationReason.PAYMENT_EXPIRED) {
            throw CancellationReasonNotAllowedException.reserved();
        }
        if (reason != null && cancelledBy.equals(booking.getBookedBy())) {
            throw new CancellationReasonNotAllowedException();
        }
        if (booking.getStatus() == BookingStatus.PENDING_PAYMENT) {
            pendingPayments.releaseLocked(booking, cancelledBy);
            return false;
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
        return cancelAndRefund(booking, cancelledBy, cancelledAt, reason);
    }

    @Override
    public boolean cancelCharged(UUID bookingId) {
        bookingGridCoordination.lock();
        if (bookings.lockById(bookingId).isEmpty()) {
            return false;
        }
        entityManager.clear();
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        Instant cancelledAt = clock.instant();
        boolean charged = payments.paymentOf(bookingId).filter(payment -> !payment.refunded()).isPresent();
        if (booking.getStatus() != BookingStatus.CONFIRMED || !charged || !cancelledAt.isBefore(startOf(booking))
                || !standingDisplacement.refuses(booking)) {
            return false;
        }
        return cancelAndRefund(booking, null, cancelledAt, null);
    }

    private boolean cancelAndRefund(Booking booking, @Nullable UUID cancelledBy, Instant cancelledAt,
                                    @Nullable CancellationReason reason) {
        boolean changed = booking.cancel(cancelledBy, cancelledAt, reason);
        bookings.saveAndFlush(booking);
        if (changed) {
            pendingPayments.releaseCourtsOf(booking);
            if (cancelledAt.isBefore(startOf(booking))) {
                payments.refund(booking.getId());
            }
        }
        return changed;
    }

    private static Instant startOf(Booking booking) {
        return booking.getAllocations().stream().map(CourtAllocation::getStartsAt).min(Instant::compareTo)
                .orElseThrow(() -> new IllegalStateException("A booking must occupy a court"));
    }

    @Override
    public boolean release(UUID bookingId) {
        bookingGridCoordination.lock();
        if (bookings.lockById(bookingId).isEmpty()) {
            return false;
        }
        entityManager.clear();
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        if (!booking.cancel(null, clock.instant(), null)) {
            return false;
        }
        bookings.saveAndFlush(booking);
        pendingPayments.releaseCourtsOf(booking);
        return true;
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

        if (outsiders.isOutsider(command.bookedBy(), command.callerRoles())
                && command.participants().stream().anyMatch(slot -> slot.kind() != ParticipantKind.GUEST)) {
            throw new ParticipantsInvalidException("booking.participants.outsiderGuestsOnly", Map.of());
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
