package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.PendingPayments;
import org.courtside.card.CardEvent;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.AvailabilityChange;
import org.courtside.facility.CourtClosure;
import org.courtside.facility.FacilityEvent;
import org.courtside.facility.OpeningPeriod;
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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;
import java.util.function.Function;

@Component
@RequiredArgsConstructor
class ClosureAnnouncements {

    private static final int PAGE_SIZE = 100;

    private final ImpactService impact;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final ClubTimeZone timeZone;
    private final BookingRepository bookings;
    private final PendingPayments pendingPayments;

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
        announce(now -> ImpactService.Period.of(now, closed.effectiveFrom(), closed.until(), timeZone.zoneId()),
                (period, cursor) -> impact.pageOfClosingWeekday(
                        DayOfWeek.of(closed.dayOfWeek()), period, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.DAY_CLOSED);
    }

    // Widening the hours displaces nobody, and the query answers that with an empty page.
    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(FacilityEvent.OpeningHoursSet set) {
        announce(now -> ImpactService.Period.of(now, set.effectiveFrom(), set.until(), timeZone.zoneId()),
                (period, cursor) -> impact.pageOfOpeningHours(DayOfWeek.of(set.dayOfWeek()),
                        new OpeningWindow(set.opensAt(), set.closesAt()), period, cursor, PAGE_SIZE),
                BookingDisplaced.Closure.HOURS_NARROWED);
    }

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(AvailabilityChange.PeriodStored stored) {
        OpeningPeriod period = stored.after().toPeriod();
        Availability current = impact.currentAvailability();
        Availability before = stored.before() == null
                ? current.withoutPeriod(period.id()) : current.withPeriod(stored.before().toPeriod());
        announce(impact.newlyUnavailable(before, current.withPeriod(period), period.startsOn(), period.endsOn(),
                clock.instant()), period.kind() == OpeningPeriod.Kind.HOLIDAY
                ? BookingDisplaced.Closure.HOLIDAY : BookingDisplaced.Closure.SEASON);
    }

    @Async("closureAnnouncementExecutor")
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void on(AvailabilityChange.ClosureStored stored) {
        CourtClosure closure = stored.after().toClosure();
        Availability current = impact.currentAvailability();
        Availability before = stored.before() == null
                ? current.withoutClosure(closure.id()) : current.withClosure(stored.before().toClosure());
        announce(impact.newlyUnavailable(before, current.withClosure(closure), closure.startsOn(),
                closure.endsOn(), clock.instant()), BookingDisplaced.Closure.COURT_CLOSED);
    }

    private void announce(List<ImpactService.AffectedBooking> affected, BookingDisplaced.Closure closure) {
        List<UUID> held = new ArrayList<>();
        displace(affected, closure, held);
        held.forEach(pendingPayments::release);
    }

    // One instant for every page: a clock read per page lets a booking that starts in between drop
    // out of the cursor's own comparison, and whoever is behind it is never told.
    private void announce(BiFunction<Instant, UUID, ImpactService.ImpactPage> page,
                          BookingDisplaced.Closure closure) {
        announce(Function.identity(), page, closure);
    }

    private <P> void announce(Function<Instant, P> window, BiFunction<P, UUID, ImpactService.ImpactPage> page,
                              BookingDisplaced.Closure closure) {
        P fixed = window.apply(clock.instant());
        List<UUID> held = new ArrayList<>();
        UUID cursor = null;
        do {
            ImpactService.ImpactPage impacted = page.apply(fixed, cursor);
            displace(impacted.bookings(), closure, held);
            cursor = impacted.nextCursor();
        } while (cursor != null);
        // Released only after the walk, because the cursor names a booking the next page must still find.
        held.forEach(pendingPayments::release);
    }

    // A booking still awaiting its payment was never confirmed, so the closure ends its hold instead.
    private void displace(List<ImpactService.AffectedBooking> affected, BookingDisplaced.Closure closure,
                          List<UUID> held) {
        if (affected.isEmpty()) {
            return;
        }
        Set<UUID> pending = new HashSet<>(bookings.findPendingAmong(
                affected.stream().map(ImpactService.AffectedBooking::bookingId).toList()));
        affected.forEach(booking -> {
            if (pending.contains(booking.bookingId())) {
                held.add(booking.bookingId());
            } else {
                events.publishEvent(new BookingDisplaced(booking.bookingId(), closure));
            }
        });
    }
}
