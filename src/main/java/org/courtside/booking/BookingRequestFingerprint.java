package org.courtside.booking;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookingRequestFingerprint {

    private final ObjectMapper objectMapper;

    String of(CreateBookingCommand command) {
        Payload payload = new Payload(
                command.courtIds().stream().sorted().toList(),
                command.cardId(), command.slot().start(), command.slot().end(), command.note(),
                command.participants().stream().map(Participant::from).toList());
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(objectMapper.writeValueAsBytes(payload)));
        } catch (JacksonException | NoSuchAlgorithmException failure) {
            throw new IllegalStateException("Cannot fingerprint a booking request", failure);
        }
    }

    private record Payload(List<UUID> courtIds, UUID cardId, Instant startsAt, Instant endsAt,
                           String note, List<Participant> participants) {
    }

    private record Participant(String kind, UUID personId, String guestName, UUID cardId) {

        private static Participant from(ParticipantSpec spec) {
            return new Participant(spec.kind().name(), spec.personId(), spec.guestName(), spec.cardId());
        }
    }
}
