package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.card.CardService;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.springframework.stereotype.Component;

import java.util.List;

/** Whether a booking's courts, card, hours or court closures refuse it as they stand now. */
@Component
@RequiredArgsConstructor
public class StandingDisplacement {

    private final ImpactService impact;
    private final FacilityService facility;
    private final CardService cards;
    private final ClubTimeZone timeZone;

    public boolean refuses(Booking booking) {
        if (!cards.requireCard(booking.getCardId()).isActive()) {
            return true;
        }
        List<BookedSlot> slots = booking.getAllocations().stream()
                .map(allocation -> new BookedSlot(booking.getId(), allocation.getCourtId(), allocation.getStartsAt(),
                        allocation.getEndsAt()))
                .toList();
        return slots.stream().anyMatch(slot -> facility.findCourt(slot.courtId()).map(court -> !court.isActive())
                .orElse(true)) || !impact.currentAvailability().admits(slots, timeZone.zoneId());
    }
}
