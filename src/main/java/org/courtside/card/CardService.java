package org.courtside.card;

import org.courtside.card.internal.BookingCardRepository;
import org.courtside.card.internal.CardLabelTakenException;
import org.courtside.card.internal.ParticipantCardRepository;
import org.courtside.identity.Role;
import org.courtside.shared.SqlConstraintViolation;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Collection;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CardService {

    private static final String UNIQUE_BOOKING_CARD_LABEL = "booking_card_unique_label";
    private static final String UNIQUE_PARTICIPANT_CARD_LABEL = "participant_card_unique_label";

    private final BookingCardRepository cards;
    private final ParticipantCardRepository participantCards;
    private final ApplicationEventPublisher events;

    public List<BookingCard> activeCards() {
        return cards.findByActiveTrueOrderByLabelAsc();
    }

    public List<BookingCard> bookableCards(Set<Role> callerRoles) {
        if (callerRoles.contains(Role.ADMIN)) {
            return activeCards();
        }
        return activeCards().stream()
                .filter(card -> card.permits(callerRoles))
                .toList();
    }

    public List<BookingCard> allCards() {
        return cards.findAllByOrderByLabelAsc();
    }

    public Optional<BookingCard> findCard(UUID cardId) {
        return cards.findById(cardId);
    }

    public List<ParticipantCard> activeParticipantCards() {
        return participantCards.findByActiveTrueOrderByLabelAsc();
    }

    public List<ParticipantCard> allParticipantCards() {
        return participantCards.findAllByOrderByLabelAsc();
    }

    public Optional<ParticipantCard> findParticipantCard(UUID cardId) {
        return participantCards.findById(cardId);
    }

    public List<ParticipantCard> lockParticipantCards(Collection<UUID> cardIds) {
        return participantCards.lockAllById(cardIds.stream().sorted().toList());
    }

    @Transactional
    public BookingCard createCard(String label, String color, Set<Role> allowedRoles,
                                  Set<Role> managingRoles, short[] allowedPlayerCounts,
                                  boolean countsAgainstLimits, boolean guestAllowed,
                                  boolean showGenericOccupancy) {
        BookingCard card = saveOrRejectTakenLabel(new BookingCard(label, color, allowedRoles, managingRoles,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed, showGenericOccupancy));
        events.publishEvent(new CardEvent.BookingCardAdded(card.getId(), List.copyOf(card.getAllowedRoles()),
                List.copyOf(card.getManagingRoles()), boxed(card.getAllowedPlayerCounts()),
                card.isCountsAgainstLimits(), card.isGuestAllowed(), card.isShowGenericOccupancy()));
        return card;
    }

    @Transactional
    public BookingCard changeCard(UUID cardId, String label, String color, Set<Role> allowedRoles,
                                  Set<Role> managingRoles, short[] allowedPlayerCounts,
                                  boolean countsAgainstLimits, boolean guestAllowed,
                                  boolean showGenericOccupancy) {
        BookingCard card = requireCard(cardId);
        List<String> changedFields = new ArrayList<>();
        if (!Objects.equals(card.getLabel(), label)) {
            changedFields.add("label");
        }
        if (!Objects.equals(card.getColor(), color)) {
            changedFields.add("color");
        }
        boolean otherFieldsChanged = !card.getAllowedRoles().equals(allowedRoles)
                || !card.getManagingRoles().equals(managingRoles)
                || !Arrays.equals(card.getAllowedPlayerCounts(), allowedPlayerCounts)
                || card.isCountsAgainstLimits() != countsAgainstLimits
                || card.isGuestAllowed() != guestAllowed
                || card.isShowGenericOccupancy() != showGenericOccupancy;
        card.changeTo(label, color, allowedRoles, managingRoles,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed, showGenericOccupancy);
        BookingCard saved = saveOrRejectTakenLabel(card);
        if (!changedFields.isEmpty() || otherFieldsChanged) {
            events.publishEvent(new CardEvent.BookingCardChanged(saved.getId(),
                    List.copyOf(saved.getAllowedRoles()), List.copyOf(saved.getManagingRoles()),
                    boxed(saved.getAllowedPlayerCounts()), saved.isCountsAgainstLimits(),
                    saved.isGuestAllowed(), saved.isShowGenericOccupancy(), List.copyOf(changedFields)));
        }
        return saved;
    }

    @Transactional
    public BookingCard setCardActive(UUID cardId, boolean active) {
        BookingCard card = requireCard(cardId);
        if (card.isActive() == active) {
            return card;
        }
        if (active) {
            card.activate();
        } else {
            card.deactivate();
        }
        events.publishEvent(new CardEvent.BookingCardAvailabilityChanged(card.getId(), active));
        return card;
    }

    @Transactional
    public ParticipantCard createParticipantCard(String label, Integer capacity) {
        ParticipantCard card = saveOrRejectTakenLabel(new ParticipantCard(label, capacity));
        events.publishEvent(new CardEvent.ParticipantCardAdded(card.getId(), card.getCapacity()));
        return card;
    }

    @Transactional
    public ParticipantCard changeParticipantCard(UUID cardId, String label, Integer capacity) {
        ParticipantCard card = requireParticipantCard(cardId);
        List<String> changedFields = Objects.equals(card.getLabel(), label) ? List.of() : List.of("label");
        boolean capacityChanged = !Objects.equals(card.getCapacity(), capacity);
        card.changeTo(label, capacity);
        ParticipantCard saved = saveOrRejectTakenLabel(card);
        if (!changedFields.isEmpty() || capacityChanged) {
            events.publishEvent(new CardEvent.ParticipantCardChanged(
                    saved.getId(), saved.getCapacity(), changedFields));
        }
        return saved;
    }

    @Transactional
    public ParticipantCard setParticipantCardActive(UUID cardId, boolean active) {
        ParticipantCard card = requireParticipantCard(cardId);
        if (card.isActive() == active) {
            return card;
        }
        if (active) {
            card.activate();
        } else {
            card.deactivate();
        }
        events.publishEvent(new CardEvent.ParticipantCardAvailabilityChanged(card.getId(), active));
        return card;
    }

    public BookingCard requireCard(UUID cardId) {
        return cards.findById(cardId)
                .orElseThrow(() -> new CardNotFoundException("No booking card with id " + cardId));
    }

    public ParticipantCard requireParticipantCard(UUID cardId) {
        return participantCards.findById(cardId)
                .orElseThrow(() -> new CardNotFoundException(
                        "No participant card with id " + cardId));
    }

    private BookingCard saveOrRejectTakenLabel(BookingCard card) {
        try {
            return cards.saveAndFlush(card);
        } catch (DataIntegrityViolationException e) {
            if (isLabelTaken(e, UNIQUE_BOOKING_CARD_LABEL)) {
                throw new CardLabelTakenException(
                        "Card label %s is already taken".formatted(card.getLabel()), e);
            }
            throw e;
        }
    }

    private ParticipantCard saveOrRejectTakenLabel(ParticipantCard card) {
        try {
            return participantCards.saveAndFlush(card);
        } catch (DataIntegrityViolationException e) {
            if (isLabelTaken(e, UNIQUE_PARTICIPANT_CARD_LABEL)) {
                throw new CardLabelTakenException(
                        "Card label %s is already taken".formatted(card.getLabel()), e);
            }
            throw e;
        }
    }

    private static boolean isLabelTaken(DataIntegrityViolationException e, String constraint) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.UNIQUE_VIOLATION, constraint);
    }

    private static List<Short> boxed(short[] values) {
        List<Short> boxed = new ArrayList<>(values.length);
        for (short value : values) {
            boxed.add(value);
        }
        return boxed;
    }
}
