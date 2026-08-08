package org.courtside.booking;

import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.internal.ParticipantKind;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.facility.FacilityService;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
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
class BookingWriter {

    private static final String OVERLAP_CONSTRAINT = "court_allocation_no_overlap";

    private final BookingRepository bookings;
    private final Clock clock;
    private final BookingRuleGate ruleGate;
    private final CardService cards;
    private final FacilityService facility;
    private final PersonRepository personRepository;

    UUID write(CreateBookingCommand command) {
        facility.requireBookableCourts(command.courtIds());
        BookingCard card = requireBookableCard(command.cardId());

        boolean overridesRestrictions = command.callerRoles().contains(Role.ADMIN);

        if (!overridesRestrictions) {
            checkRequiredRole(card, command.callerRoles());
        }
        List<ParticipantSpec> slots = resolveSlots(card, command);
        ruleGate.requireNoViolations(BookingRuleCheck.of(command));

        Booking booking = new Booking(
                command.cardId(), command.bookedBy(), command.note(), clock.instant());
        command.courtIds().forEach(courtId -> booking.allocate(courtId, command.slot()));
        slots.forEach(booking::addParticipant);
        booking.joinSeries(command.seriesId());

        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException e) {
            if (isOverlap(e)) {
                throw new CourtUnavailableException(
                        "One of the requested courts is already occupied for that time", e);
            }
            throw e;
        }
        return booking.getId();
    }

    void cancel(UUID bookingId, UUID cancelledBy, Set<Role> cancellerRoles) {
        Booking booking = bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));

        if (!cancellerRoles.contains(Role.ADMIN) && !cancelledBy.equals(booking.getBookedBy())) {
            throw new BookingNotOwnedException(
                    "Account %s may not cancel booking %s".formatted(cancelledBy, bookingId));
        }

        booking.cancel(cancelledBy, clock.instant());
        bookings.saveAndFlush(booking);
    }

    private BookingCard requireBookableCard(UUID cardId) {
        BookingCard card = cards.findCard(cardId)
                .orElseThrow(() -> new IllegalArgumentException("No booking card with id " + cardId));
        if (!card.isActive()) {
            throw new IllegalArgumentException("Booking card %s is not active".formatted(cardId));
        }
        return card;
    }

    private boolean isOverlap(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(OVERLAP_CONSTRAINT);
    }

    private void checkRequiredRole(BookingCard card, Set<Role> callerRoles) {
        if (!card.permits(callerRoles)) {
            throw new CardRoleRequiredException(
                    "Card %s requires role %s".formatted(card.getId(), card.getRequiredRole()));
        }
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

        checkCardCapacity(slots, command.slot());

        return slots;
    }

    private boolean isBookableCard(UUID participantCardId) {
        return cards.findParticipantCard(participantCardId)
                .filter(ParticipantCard::isActive)
                .isPresent();
    }

    private void checkCardCapacity(List<ParticipantSpec> slots, TimeSlot slot) {
        Map<UUID, Long> namedCounts = slots.stream()
                .filter(spec -> spec.kind() == ParticipantKind.CARD)
                .collect(Collectors.groupingBy(ParticipantSpec::cardId, Collectors.counting()));

        for (Map.Entry<UUID, Long> entry : namedCounts.entrySet()) {
            ParticipantCard card = cards.findParticipantCard(entry.getKey()).orElseThrow();
            if (!card.isLimited()) {
                continue;
            }
            long usedAtThisTime = bookings.countCardUsageOverlapping(
                    card.getId(), slot.start(), slot.end());
            if (usedAtThisTime + entry.getValue() > card.getCapacity()) {
                throw new ParticipantsInvalidException("booking.participants.cardUnavailable",
                        Map.of("cardLabel", card.getLabel(), "capacity", card.getCapacity()));
            }
        }
    }

    private String allowedAsText(BookingCard card) {
        return IntStream.range(0, card.getAllowedPlayerCounts().length)
                .mapToObj(i -> String.valueOf(card.getAllowedPlayerCounts()[i]))
                .collect(Collectors.joining(" / "));
    }
}
