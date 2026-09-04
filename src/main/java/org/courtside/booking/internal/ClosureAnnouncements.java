package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.card.CardEvent;
import org.courtside.facility.FacilityEvent;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.OpeningWindow;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BiFunction;

@Component
@RequiredArgsConstructor
class ClosureAnnouncements {

    private static final int PAGE_SIZE = 100;

    private final ImpactService impact;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.CourtAvailabilityChanged changed) {
        if (changed.active()) {
            return;
        }
        announce((from, cursor) -> impact.pageOfDeactivating(changed.courtId(), from, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.COURT_OUT_OF_SERVICE);
    }

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(CardEvent.BookingCardAvailabilityChanged changed) {
        if (changed.active()) {
            return;
        }
        announce((from, cursor) -> impact.pageOfRetiringCard(changed.cardId(), from, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.CARD_OUT_OF_SERVICE);
    }

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.OpeningHoursClosed closed) {
        announce((from, cursor) -> impact.pageOfClosingWeekday(
                        DayOfWeek.of(closed.dayOfWeek()), from, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.DAY_CLOSED);
    }

    // Widening the hours displaces nobody, and the query answers that with an empty page.
    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.OpeningHoursSet set) {
        announce((from, cursor) -> impact.pageOfOpeningHours(DayOfWeek.of(set.dayOfWeek()),
                        new OpeningWindow(set.opensAt(), set.closesAt()), from, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.HOURS_NARROWED);
    }

    // One instant for every page: a clock read per page lets a booking that starts in between drop
    // out of the cursor's own comparison, and whoever is behind it is never told.
    private void announce(BiFunction<Instant, UUID, ImpactService.ImpactPage> page,
                          BookingDisplaced.Closure closure) {
        Instant from = clock.instant();
        UUID cursor = null;
        do {
            ImpactService.ImpactPage impacted = page.apply(from, cursor);
            impacted.bookings().forEach(booking ->
                    events.publishEvent(new BookingDisplaced(booking.bookingId(), closure)));
            cursor = impacted.nextCursor();
        } while (cursor != null);
    }
}
