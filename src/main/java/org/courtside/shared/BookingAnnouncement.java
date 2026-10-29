package org.courtside.shared;

import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookingAnnouncement(UUID bookedByAccountId, List<UUID> playerPersonIds,
                                  Instant startsAt, Instant endsAt,
                                  List<AnnouncedCourt> courts, String cardLabel, boolean cancelled,
                                  @Nullable AnnouncedAccess access) {

    public BookingAnnouncement {
        playerPersonIds = List.copyOf(playerPersonIds);
        courts = List.copyOf(courts);
    }

    public record AnnouncedCourt(int number, String name) {
    }

    /** The static codes that open the booking's access points from {@code validFrom} until {@code validUntil}. */
    public record AnnouncedAccess(Instant validFrom, Instant validUntil, List<AccessCode> codes) {

        public AnnouncedAccess {
            if (validFrom == null || validUntil == null || !validUntil.isAfter(validFrom)) {
                throw new IllegalArgumentException("A validity window ends after it starts");
            }
            if (codes == null || codes.isEmpty()) {
                throw new IllegalArgumentException("An access grant carries at least one code");
            }
            codes = List.copyOf(codes);
        }
    }

    public record AccessCode(String accessPointName, String code) {
    }
}
