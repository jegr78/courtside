package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OccupancySignal {

    public static final Duration HORIZON = Duration.ofHours(24);

    private final FacilityService facility;
    private final CourtAllocationRepository allocations;
    private final Clock clock;

    public record CourtSignal(int courtNumber, boolean occupied, long minutes) {
    }

    record NextStart(UUID courtId, Instant startsAt) {
    }

    /** Every active court by number, occupied now or the whole minutes until its next signalling booking. */
    public List<CourtSignal> read() {
        Instant now = clock.instant();
        Map<UUID, Instant> nextStarts = allocations.nextSignallingStarts(now, now.plus(HORIZON)).stream()
                .collect(Collectors.toMap(NextStart::courtId, NextStart::startsAt));
        return facility.activeCourts().stream()
                .map(court -> signalOf(court, nextStarts.get(court.getId()), now))
                .toList();
    }

    private static CourtSignal signalOf(Court court, Instant nextStart, Instant now) {
        if (nextStart == null) {
            return new CourtSignal(court.getNumber(), false, HORIZON.toMinutes());
        }
        if (!nextStart.isAfter(now)) {
            return new CourtSignal(court.getNumber(), true, 0);
        }
        return new CourtSignal(court.getNumber(), false, Duration.between(now, nextStart).toMinutes());
    }
}
