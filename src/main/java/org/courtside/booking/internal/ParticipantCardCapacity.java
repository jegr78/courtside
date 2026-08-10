package org.courtside.booking.internal;

import org.courtside.booking.BookingParticipant;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class ParticipantCardCapacity {

    private static final String UNAVAILABLE = "booking.participants.cardUnavailable";

    private final BookingRepository bookings;
    private final CardService cards;

    public void requireAvailableForSpecs(List<ParticipantSpec> participants, TimeSlot slot) {
        requireAvailable(cardCounts(participants, ParticipantSpec::cardId, ParticipantSpec::kind),
                slot, Set.of());
    }

    public void requireAvailableForParticipants(List<BookingParticipant> participants, TimeSlot slot,
                                                UUID bookingId, Collection<UUID> excludedBookingIds,
                                                List<Target> targets) {
        requireAvailable(cardCounts(participants, BookingParticipant::getCardId,
                BookingParticipant::getKind), slot, excludedBookingIds,
                additionalUsage(bookingId, slot, targets));
    }

    public List<RuleViolation> violationsFor(List<BookingParticipant> participants, TimeSlot slot,
                                             UUID bookingId, Collection<UUID> excludedBookingIds,
                                             List<Target> targets) {
        return violations(cardCounts(participants, BookingParticipant::getCardId,
                BookingParticipant::getKind), slot, excludedBookingIds,
                additionalUsage(bookingId, slot, targets), false);
    }

    public record Target(UUID bookingId, List<BookingParticipant> participants, TimeSlot slot) {
    }

    private void requireAvailable(Map<UUID, Long> requested, TimeSlot slot,
                                  Collection<UUID> excludedBookingIds) {
        violations(requested, slot, excludedBookingIds, Map.of(), true).stream().findFirst()
                .ifPresent(violation -> {
                    throw new ParticipantsInvalidException(violation.code(), violation.params());
                });
    }

    private void requireAvailable(Map<UUID, Long> requested, TimeSlot slot,
                                  Collection<UUID> excludedBookingIds,
                                  Map<UUID, Long> additionalUsage) {
        violations(requested, slot, excludedBookingIds, additionalUsage, true).stream().findFirst()
                .ifPresent(violation -> {
                    throw new ParticipantsInvalidException(violation.code(), violation.params());
                });
    }

    private List<RuleViolation> violations(Map<UUID, Long> requested, TimeSlot slot,
                                           Collection<UUID> excludedBookingIds,
                                           Map<UUID, Long> additionalUsage, boolean lockCards) {
        List<ParticipantCard> participantCards = lockCards
                ? cards.lockParticipantCards(requested.keySet())
                : requested.keySet().stream().map(cards::requireParticipantCard).toList();
        Map<UUID, ParticipantCard> cardsById = participantCards.stream()
                .collect(Collectors.toMap(ParticipantCard::getId, Function.identity()));
        return requested.entrySet().stream()
                .map(entry -> violation(entry, cardsById.get(entry.getKey()), slot, excludedBookingIds,
                        additionalUsage.getOrDefault(entry.getKey(), 0L)))
                .flatMap(Optional::stream)
                .toList();
    }

    private Optional<RuleViolation> violation(Map.Entry<UUID, Long> entry, ParticipantCard card, TimeSlot slot,
                                              Collection<UUID> excludedBookingIds, long additionalUsage) {
        if (card == null) {
            throw new IllegalStateException("Participant card disappeared after validation");
        }
        if (!card.isLimited()) {
            return Optional.empty();
        }
        long used = excludedBookingIds.isEmpty()
                ? bookings.countCardUsageOverlapping(card.getId(), slot.start(), slot.end())
                : bookings.countCardUsageOverlappingExcluding(
                        card.getId(), slot.start(), slot.end(), excludedBookingIds);
        if (used + entry.getValue() + additionalUsage <= card.getCapacity()) {
            return Optional.empty();
        }
        return Optional.of(new RuleViolation(UNAVAILABLE,
                Map.of("cardLabel", card.getLabel(), "capacity", card.getCapacity())));
    }

    private Map<UUID, Long> additionalUsage(UUID bookingId, TimeSlot slot, List<Target> targets) {
        return targets.stream()
                .filter(target -> !target.bookingId().equals(bookingId))
                .filter(target -> target.slot().overlaps(slot))
                .flatMap(target -> target.participants().stream())
                .filter(participant -> participant.getKind() == ParticipantKind.CARD)
                .collect(Collectors.groupingBy(BookingParticipant::getCardId, Collectors.counting()));
    }

    private <T> Map<UUID, Long> cardCounts(List<T> participants, Function<T, UUID> cardId,
                                           Function<T, ParticipantKind> kind) {
        return participants.stream()
                .filter(participant -> kind.apply(participant) == ParticipantKind.CARD)
                .collect(Collectors.groupingBy(cardId, Collectors.counting()));
    }
}
