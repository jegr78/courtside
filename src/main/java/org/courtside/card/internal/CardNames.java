package org.courtside.card.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class CardNames implements ConfigurationSubjectNames {

    private final BookingCardRepository cards;
    private final ParticipantCardRepository participantCards;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        cards.findAllById(subjectIds)
                .forEach(card -> names.put(card.getId(), card.getLabel()));
        participantCards.findAllById(subjectIds)
                .forEach(card -> names.put(card.getId(), card.getLabel()));
        return names;
    }
}
