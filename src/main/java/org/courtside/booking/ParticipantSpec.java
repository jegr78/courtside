package org.courtside.booking;

import org.courtside.booking.internal.ParticipantKind;
import org.courtside.booking.internal.ParticipantsInvalidException;

import java.util.Map;
import java.util.UUID;

public record ParticipantSpec(ParticipantKind kind, UUID personId, String guestName, UUID cardId) {

    public static ParticipantSpec member(UUID personId) {
        return new ParticipantSpec(ParticipantKind.MEMBER, personId, null, null);
    }

    public static ParticipantSpec guest(String guestName) {
        return new ParticipantSpec(ParticipantKind.GUEST, null, guestName, null);
    }

    public static ParticipantSpec card(UUID cardId) {
        return new ParticipantSpec(ParticipantKind.CARD, null, null, cardId);
    }

    public static ParticipantSpec from(UUID personId, String guestName, UUID cardId) {
        boolean named = guestName != null && !guestName.isBlank();
        int fillers = (personId != null ? 1 : 0) + (named ? 1 : 0) + (cardId != null ? 1 : 0);
        if (fillers != 1 || (guestName != null && !named)) {
            throw new ParticipantsInvalidException("booking.participants.invalid", Map.of());
        }
        if (personId != null) {
            return member(personId);
        }
        return named ? guest(guestName) : card(cardId);
    }
}
