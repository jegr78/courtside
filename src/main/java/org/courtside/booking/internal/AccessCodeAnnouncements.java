package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.config.AccessPolicy;
import org.courtside.shared.AccessCodeChanged;
import org.courtside.shared.BookingAccessCodeChanged;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;

@Component
@RequiredArgsConstructor
class AccessCodeAnnouncements {

    private final BookingRepository bookings;
    private final AccessPolicy policy;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    // Every booking whose window is still open: a player on the court now needs the new code to come back in.
    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(AccessCodeChanged changed) {
        if (changed.courtIds().isEmpty()) {
            return;
        }
        bookings.findGrantingAccessOnCourtsEndingAfter(changed.courtIds(),
                        clock.instant().minus(policy.accessLag().toDuration()))
                .forEach(bookingId -> events.publishEvent(new BookingAccessCodeChanged(bookingId)));
    }
}
