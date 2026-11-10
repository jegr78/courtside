package org.courtside.booking.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

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

@Slf4j
@Component
class ClosureAnnouncements {

    private static final int PAGE_SIZE = 100;

    private final ImpactService impact;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final ClubTimeZone timeZone;
    private final BookingRepository bookings;
    private final PendingPayments pendingPayments;
    private final DisplacedPayments displacedPayments;
    private final TransactionTemplate separately;

    ClosureAnnouncements(ImpactService impact, ApplicationEventPublisher events, Clock clock, ClubTimeZone timeZone,
                         BookingRepository bookings, PendingPayments pendingPayments,
                         DisplacedPayments displacedPayments, PlatformTransactionManager transactions) {
        this.impact = impact;
        this.events = events;
        this.clock = clock;
        this.timeZone = timeZone;
        this.bookings = bookings;
        this.pendingPayments = pendingPayments;
        this.displacedPayments = displacedPayments;
        this.separately = new TransactionTemplate(transactions);
        this.separately.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

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
        List<UUID> confirmed = new ArrayList<>();
        List<UUID> held = new ArrayList<>();
        sort(affected, confirmed, held);
        confirmed.forEach(bookingId -> displace(bookingId, closure));
        held.forEach(bookingId -> releaseOrDisplace(bookingId, closure));
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
        List<UUID> confirmed = new ArrayList<>();
        List<UUID> held = new ArrayList<>();
        UUID cursor = null;
        do {
            ImpactService.ImpactPage impacted = page.apply(fixed, cursor);
            sort(impacted.bookings(), confirmed, held);
            cursor = impacted.nextCursor();
        } while (cursor != null);
        // Cancelled only after the walk, because the cursor names a booking the next page must still find.
        confirmed.forEach(bookingId -> displace(bookingId, closure));
        held.forEach(bookingId -> releaseOrDisplace(bookingId, closure));
    }

    // A payment confirmed since the page was read turns the hold into a booking the closure displaces.
    private void releaseOrDisplace(UUID bookingId, BookingDisplaced.Closure closure) {
        try {
            if (Boolean.TRUE.equals(separately.execute(status -> !pendingPayments.release(bookingId)
                    && bookings.findById(bookingId).filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED)
                    .isPresent()))) {
                displace(bookingId, closure);
            }
        } catch (RuntimeException failed) {
            log.warn("A closure could not release pending booking {}; its payment deadline ends the hold", bookingId,
                    failed);
        }
    }

    // A booking still awaiting its payment was never confirmed, so the closure ends its hold instead.
    private void sort(List<ImpactService.AffectedBooking> affected, List<UUID> confirmed, List<UUID> held) {
        if (affected.isEmpty()) {
            return;
        }
        Set<UUID> pending = new HashSet<>(bookings.findPendingAmong(
                affected.stream().map(ImpactService.AffectedBooking::bookingId).toList()));
        affected.forEach(booking -> (pending.contains(booking.bookingId()) ? held : confirmed)
                .add(booking.bookingId()));
    }

    // A booking the booker paid for is cancelled and its charge returned; one nobody paid for stays.
    private void displace(UUID bookingId, BookingDisplaced.Closure closure) {
        try {
            if (Boolean.TRUE.equals(separately.execute(status -> {
                boolean cancelled = displacedPayments.cancelCharged(bookingId);
                if (cancelled) {
                    events.publishEvent(new BookingDisplaced(bookingId, closure, true));
                }
                return cancelled;
            }))) {
                return;
            }
        } catch (RuntimeException failed) {
            log.warn("A closure could not cancel paid booking {}; it stays and the club refunds it by cancelling",
                    bookingId, failed);
        }
        events.publishEvent(new BookingDisplaced(bookingId, closure));
    }
}
