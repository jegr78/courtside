package org.courtside.card;

import org.courtside.card.internal.BookingCardRepository;
import org.courtside.card.internal.CardLabelTakenException;
import org.courtside.card.internal.ParticipantCardRepository;
import org.courtside.identity.Role;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Collection;
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
                                  short[] allowedPlayerCounts, boolean countsAgainstLimits,
                                  boolean guestAllowed, boolean showGenericOccupancy) {
        return saveOrRejectTakenLabel(new BookingCard(label, color, allowedRoles,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed, showGenericOccupancy));
    }

    @Transactional
    public BookingCard changeCard(UUID cardId, String label, String color, Set<Role> allowedRoles,
                                  short[] allowedPlayerCounts, boolean countsAgainstLimits,
                                  boolean guestAllowed, boolean showGenericOccupancy) {
        BookingCard card = requireCard(cardId);
        card.changeTo(label, color, allowedRoles,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed, showGenericOccupancy);
        return saveOrRejectTakenLabel(card);
    }

    @Transactional
    public BookingCard setCardActive(UUID cardId, boolean active) {
        BookingCard card = requireCard(cardId);
        if (active) {
            card.activate();
        } else {
            card.deactivate();
        }
        return card;
    }

    @Transactional
    public ParticipantCard createParticipantCard(String label, Integer capacity) {
        return saveOrRejectTakenLabel(new ParticipantCard(label, capacity));
    }

    @Transactional
    public ParticipantCard changeParticipantCard(UUID cardId, String label, Integer capacity) {
        ParticipantCard card = requireParticipantCard(cardId);
        card.changeTo(label, capacity);
        return saveOrRejectTakenLabel(card);
    }

    @Transactional
    public ParticipantCard setParticipantCardActive(UUID cardId, boolean active) {
        ParticipantCard card = requireParticipantCard(cardId);
        if (active) {
            card.activate();
        } else {
            card.deactivate();
        }
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
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(constraint);
    }
}
