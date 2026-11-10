package org.courtside.booking.internal;

import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.PendingPayments;
import org.courtside.card.CardEvent;
import org.courtside.facility.FacilityEvent;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClosureAnnouncementsTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:00:00Z");
    private static final ImpactService.Period FROM_NOW = ImpactService.Period.of(NOW, null, null, ZoneOffset.UTC);

    @Test
    void givenSeveralOpeningHoursImpactPages_whenAnnouncing_thenItPublishesEachBookingAfterTheWalk() {
        // given
        ImpactService impact = mock(ImpactService.class);
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        ClosureAnnouncements announcements = new ClosureAnnouncements(
                impact, events, Clock.fixed(NOW, ZoneOffset.UTC), () -> ZoneOffset.UTC,
                mock(BookingRepository.class), mock(PendingPayments.class), mock(DisplacedPayments.class),
                mock(PlatformTransactionManager.class));
        UUID firstBooking = UUID.randomUUID();
        UUID secondBooking = UUID.randomUUID();
        UUID cursor = UUID.randomUUID();
        OpeningWindow window = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(18, 0));
        when(impact.pageOfOpeningHours(DayOfWeek.MONDAY, window, FROM_NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(cursor, List.of(affected(firstBooking))));
        when(impact.pageOfOpeningHours(DayOfWeek.MONDAY, window, FROM_NOW, cursor, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(secondBooking))));

        // when
        announcements.on(new FacilityEvent.OpeningHoursSet(UUID.randomUUID(), DayOfWeek.MONDAY.getValue(),
                window.opensAt(), window.closesAt(), UUID.randomUUID(), null, null));

        // then
        var ordered = inOrder(impact, events);
        ordered.verify(impact).pageOfOpeningHours(DayOfWeek.MONDAY, window, FROM_NOW, null, 100);
        ordered.verify(impact).pageOfOpeningHours(DayOfWeek.MONDAY, window, FROM_NOW, cursor, 100);
        ordered.verify(events).publishEvent(
                new BookingDisplaced(firstBooking, BookingDisplaced.Closure.HOURS_NARROWED));
        ordered.verify(events).publishEvent(
                new BookingDisplaced(secondBooking, BookingDisplaced.Closure.HOURS_NARROWED));
        ordered.verifyNoMoreInteractions();
    }

    @Test
    void givenEveryClosureKind_whenAnnouncing_thenItUsesCountFreePages() {
        // given
        ImpactService impact = mock(ImpactService.class);
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        ClosureAnnouncements announcements = new ClosureAnnouncements(
                impact, events, Clock.fixed(NOW, ZoneOffset.UTC), () -> ZoneOffset.UTC,
                mock(BookingRepository.class), mock(PendingPayments.class), mock(DisplacedPayments.class),
                mock(PlatformTransactionManager.class));
        UUID courtId = UUID.randomUUID();
        UUID cardId = UUID.randomUUID();
        when(impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));
        when(impact.pageOfRetiringCard(cardId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));
        when(impact.pageOfClosingWeekday(DayOfWeek.TUESDAY, FROM_NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));

        // when
        announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));
        announcements.on(new CardEvent.BookingCardAvailabilityChanged(cardId, false));
        announcements.on(new FacilityEvent.OpeningHoursClosed(
                UUID.randomUUID(), DayOfWeek.TUESDAY.getValue(), UUID.randomUUID(), null, null));

        // then
        verify(impact).pageOfDeactivating(courtId, NOW, null, 100);
        verify(impact).pageOfRetiringCard(cardId, NOW, null, 100);
        verify(impact).pageOfClosingWeekday(DayOfWeek.TUESDAY, FROM_NOW, null, 100);
    }

    @Test
    void givenHoursScheduledFromALaterDayUntilTheNextWeek_whenAnnouncing_thenOnlyThatPeriodIsRead() {
        // given
        ImpactService impact = mock(ImpactService.class);
        ClosureAnnouncements announcements = new ClosureAnnouncements(impact,
                mock(ApplicationEventPublisher.class), Clock.fixed(NOW, ZoneOffset.UTC), () -> ZoneOffset.UTC,
                mock(BookingRepository.class), mock(PendingPayments.class), mock(DisplacedPayments.class),
                mock(PlatformTransactionManager.class));
        OpeningWindow window = new OpeningWindow(LocalTime.of(10, 0), LocalTime.of(18, 0));
        ImpactService.Period winter = new ImpactService.Period(
                Instant.parse("2026-11-01T00:00:00Z"), Instant.parse("2027-03-01T00:00:00Z"));
        when(impact.pageOfOpeningHours(any(), any(), any(), any(), anyInt()))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));

        // when
        announcements.on(new FacilityEvent.OpeningHoursSet(UUID.randomUUID(), DayOfWeek.MONDAY.getValue(),
                window.opensAt(), window.closesAt(), UUID.randomUUID(),
                LocalDate.of(2026, 11, 1), LocalDate.of(2027, 3, 1)));

        // then
        verify(impact).pageOfOpeningHours(DayOfWeek.MONDAY, window, winter, null, 100);
    }

    @Test
    void givenAHeldBookingConfirmedDuringTheWalk_whenTheReleaseFindsItConfirmed_thenTheClosureDisplacesIt() {
        // given
        UUID courtId = UUID.randomUUID();
        UUID held = UUID.randomUUID();
        Fixture fixture = new Fixture();
        when(fixture.impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(held))));
        when(fixture.bookings.findPendingAmong(List.of(held))).thenReturn(List.of(held));
        when(fixture.pendingPayments.release(held)).thenReturn(false);
        when(fixture.bookings.findById(held)).thenReturn(Optional.of(
                new Booking(UUID.randomUUID(), UUID.randomUUID(), null, NOW)));

        // when
        fixture.announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));

        // then
        verify(fixture.events).publishEvent(new BookingDisplaced(held, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE));
    }

    @Test
    void givenAPaidBooking_whenAnnouncing_thenItIsCancelledAndAnnouncedAsCancelledOnce() {
        // given
        UUID courtId = UUID.randomUUID();
        UUID paid = UUID.randomUUID();
        Fixture fixture = new Fixture();
        when(fixture.impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(paid))));
        when(fixture.displacedPayments.cancelCharged(paid)).thenReturn(true);

        // when
        fixture.announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));

        // then
        verify(fixture.events).publishEvent(
                new BookingDisplaced(paid, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE, true));
        verify(fixture.events, never()).publishEvent(
                new BookingDisplaced(paid, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE));
    }

    @Test
    void givenAHeldBookingPaidDuringTheWalk_whenTheReleaseFindsItConfirmed_thenItIsCancelledAndRefunded() {
        // given
        UUID courtId = UUID.randomUUID();
        UUID held = UUID.randomUUID();
        Fixture fixture = new Fixture();
        when(fixture.impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(held))));
        when(fixture.bookings.findPendingAmong(List.of(held))).thenReturn(List.of(held));
        when(fixture.pendingPayments.release(held)).thenReturn(false);
        when(fixture.bookings.findById(held)).thenReturn(Optional.of(
                new Booking(UUID.randomUUID(), UUID.randomUUID(), null, NOW)));
        when(fixture.displacedPayments.cancelCharged(held)).thenReturn(true);

        // when
        fixture.announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));

        // then
        verify(fixture.events).publishEvent(
                new BookingDisplaced(held, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE, true));
    }

    @Test
    void givenAHeldBookingTheClosureReleases_whenAnnouncing_thenItIsNotDisplaced() {
        // given
        UUID courtId = UUID.randomUUID();
        UUID held = UUID.randomUUID();
        Fixture fixture = new Fixture();
        when(fixture.impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(held))));
        when(fixture.bookings.findPendingAmong(List.of(held))).thenReturn(List.of(held));
        when(fixture.pendingPayments.release(held)).thenReturn(true);

        // when
        fixture.announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));

        // then
        verify(fixture.events, never()).publishEvent(any(BookingDisplaced.class));
    }

    @Test
    void givenAReleaseThatFails_whenAnnouncing_thenTheOtherBookingsAreStillDisplacedAndReleased() {
        // given
        UUID courtId = UUID.randomUUID();
        UUID confirmed = UUID.randomUUID();
        UUID failing = UUID.randomUUID();
        UUID held = UUID.randomUUID();
        Fixture fixture = new Fixture();
        when(fixture.impact.pageOfDeactivating(courtId, NOW, null, 100)).thenReturn(new ImpactService.ImpactPage(
                null, List.of(affected(confirmed), affected(failing), affected(held))));
        when(fixture.bookings.findPendingAmong(List.of(confirmed, failing, held))).thenReturn(List.of(failing, held));
        when(fixture.pendingPayments.release(failing)).thenThrow(new IllegalStateException("lock timeout"));
        when(fixture.pendingPayments.release(held)).thenReturn(true);

        // when
        fixture.announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));

        // then
        verify(fixture.events).publishEvent(
                new BookingDisplaced(confirmed, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE));
        verify(fixture.pendingPayments).release(held);
    }

    private static final class Fixture {
        final ImpactService impact = mock(ImpactService.class);
        final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        final BookingRepository bookings = mock(BookingRepository.class);
        final PendingPayments pendingPayments = mock(PendingPayments.class);
        final DisplacedPayments displacedPayments = mock(DisplacedPayments.class);
        final ClosureAnnouncements announcements = new ClosureAnnouncements(impact, events,
                Clock.fixed(NOW, ZoneOffset.UTC), () -> ZoneOffset.UTC, bookings, pendingPayments, displacedPayments,
                mock(PlatformTransactionManager.class));
    }

    private static ImpactService.AffectedBooking affected(UUID bookingId) {
        return new ImpactService.AffectedBooking(
                bookingId, List.of(UUID.randomUUID()), NOW.plusSeconds(3600), NOW.plusSeconds(7200));
    }
}
