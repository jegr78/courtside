package org.courtside.shared;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookingAnnouncement(UUID bookedByAccountId, List<UUID> playerPersonIds,
                                  Instant startsAt, Instant endsAt,
                                  List<AnnouncedCourt> courts, String cardLabel) {

    public BookingAnnouncement {
        playerPersonIds = List.copyOf(playerPersonIds);
        courts = List.copyOf(courts);
    }

    public record AnnouncedCourt(int number, String name) {
    }
}
