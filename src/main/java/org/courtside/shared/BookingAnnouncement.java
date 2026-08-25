package org.courtside.shared;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookingAnnouncement(UUID bookedByAccountId, Instant startsAt, Instant endsAt,
                                  List<AnnouncedCourt> courts, String cardLabel) {

    public BookingAnnouncement {
        courts = List.copyOf(courts);
    }

    public record AnnouncedCourt(int number, String name) {
    }
}
