package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.config.AccessPolicy;
import org.courtside.facility.FacilityService;
import org.courtside.shared.AccessCodeChanged;
import org.courtside.shared.BookingAccessCodeChanged;
import org.courtside.shared.CardGrantsAccess;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class AccessCodeAnnouncements {

    private final BookingRepository bookings;
    private final FacilityService facility;
    private final AccessPolicy policy;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    // A booking whose window is still open counts: a player on the court now needs the code to come back in.
    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(AccessCodeChanged changed) {
        if (changed.courtIds().isEmpty()) {
            return;
        }
        announce(bookings.findGrantingAccessOnCourtsEndingAfter(changed.courtIds(), windowStillOpenAfter()));
    }

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(CardGrantsAccess granted) {
        Set<UUID> courtsBehindACode = facility.activeAccessPointsWithCodes().stream()
                .flatMap(accessPoint -> accessPoint.getCourtIds().stream()).collect(Collectors.toSet());
        if (courtsBehindACode.isEmpty()) {
            return;
        }
        announce(bookings.findOfCardOnCourtsEndingAfter(granted.cardId(), courtsBehindACode, windowStillOpenAfter()));
    }

    private Instant windowStillOpenAfter() {
        return clock.instant().minus(policy.accessLag().toDuration());
    }

    private void announce(List<UUID> bookingIds) {
        bookingIds.forEach(bookingId -> events.publishEvent(new BookingAccessCodeChanged(bookingId)));
    }
}
