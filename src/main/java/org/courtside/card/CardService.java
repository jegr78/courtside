package org.courtside.card;

import org.courtside.card.internal.BookingCardRepository;
import org.courtside.card.internal.CardLabelTakenException;
import org.courtside.card.internal.ParticipantCardRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CardService {

    private static final String UNIQUE_BOOKING_CARD_LABEL = "booking_card_unique_label";
    private static final String UNIQUE_PARTICIPANT_CARD_LABEL = "participant_card_unique_label";
    private static final String ADMIN_ROLE = "ADMIN";

    private final BookingCardRepository cards;
    private final ParticipantCardRepository participantCards;

    public List<BookingCard> activeCards() {
        return cards.findByActiveTrueOrderByLabelAsc();
    }

    public List<BookingCard> bookableCards(Set<String> callerRoles) {
        if (callerRoles.contains(ADMIN_ROLE)) {
            return activeCards();
        }
        return activeCards().stream()
                .filter(card -> isBookableBy(card, callerRoles))
                .toList();
    }

    private static boolean isBookableBy(BookingCard card, Set<String> callerRoles) {
        String required = card.getRequiredRole();
        return required == null || callerRoles.contains(required);
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

    @Transactional
    public BookingCard createCard(String label, String color, String requiredRole,
                                  short[] allowedPlayerCounts, boolean countsAgainstLimits,
                                  boolean guestAllowed) {
        return saveOrRejectTakenLabel(new BookingCard(label, color, requiredRole,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed));
    }

    @Transactional
    public BookingCard changeCard(UUID cardId, String label, String color, String requiredRole,
                                  short[] allowedPlayerCounts, boolean countsAgainstLimits,
                                  boolean guestAllowed) {
        BookingCard card = requireCard(cardId);
        card.changeTo(label, color, requiredRole,
                allowedPlayerCounts, countsAgainstLimits, guestAllowed);
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
