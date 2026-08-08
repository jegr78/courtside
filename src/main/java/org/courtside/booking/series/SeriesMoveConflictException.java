package org.courtside.booking.series;

import lombok.Getter;

import java.util.List;
import java.util.UUID;

@Getter
public class SeriesMoveConflictException extends RuntimeException {

    private final List<UUID> blockedBookingIds;

    public SeriesMoveConflictException(List<UUID> blockedBookingIds) {
        super("%d occurrences cannot move".formatted(blockedBookingIds.size()));
        this.blockedBookingIds = List.copyOf(blockedBookingIds);
    }
}
