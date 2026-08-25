package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.CardEvent;
import org.courtside.facility.FacilityEvent;
import org.courtside.shared.BookingDisplaced;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.DayOfWeek;
import java.util.UUID;
import java.util.function.Function;

@Component
@RequiredArgsConstructor
class ClosureAnnouncements {

    private static final int PAGE_SIZE = 100;

    private final ImpactService impact;
    private final ApplicationEventPublisher events;

    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.CourtAvailabilityChanged changed) {
        if (changed.active()) {
            return;
        }
        announce(cursor -> impact.ofDeactivating(changed.courtId(), cursor, PAGE_SIZE),
                BookingDisplaced.Closure.COURT_OUT_OF_SERVICE);
    }

    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(CardEvent.BookingCardAvailabilityChanged changed) {
        if (changed.active()) {
            return;
        }
        announce(cursor -> impact.ofRetiringCard(changed.cardId(), cursor, PAGE_SIZE),
                BookingDisplaced.Closure.CARD_OUT_OF_SERVICE);
    }

    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.OpeningHoursClosed closed) {
        announce(cursor -> impact.ofClosingWeekday(DayOfWeek.of(closed.dayOfWeek()), cursor, PAGE_SIZE),
                BookingDisplaced.Closure.DAY_CLOSED);
    }

    // Every page, because a closure reaches whoever it reaches — the board's list is paged for
    // reading, this one is not for skipping.
    private void announce(Function<UUID, ImpactService.Impact> page, BookingDisplaced.Closure closure) {
        UUID cursor = null;
        do {
            ImpactService.Impact impacted = page.apply(cursor);
            impacted.bookings().forEach(booking ->
                    events.publishEvent(new BookingDisplaced(booking.bookingId(), closure)));
            cursor = impacted.nextCursor();
        } while (cursor != null);
    }
}
