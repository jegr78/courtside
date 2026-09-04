package org.courtside.booking.internal;

import org.courtside.card.CardEvent;
import org.courtside.facility.FacilityEvent;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClosureAnnouncementsTest {

    private static final Instant NOW = Instant.parse("2026-09-05T10:00:00Z");

    @Test
    void givenSeveralOpeningHoursImpactPages_whenAnnouncing_thenItPublishesEachBookingWithoutCounting() {
        // given
        ImpactService impact = mock(ImpactService.class);
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        ClosureAnnouncements announcements = new ClosureAnnouncements(
                impact, events, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID firstBooking = UUID.randomUUID();
        UUID secondBooking = UUID.randomUUID();
        UUID cursor = UUID.randomUUID();
        OpeningWindow window = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(18, 0));
        when(impact.pageOfOpeningHours(DayOfWeek.MONDAY, window, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(cursor, List.of(affected(firstBooking))));
        when(impact.pageOfOpeningHours(DayOfWeek.MONDAY, window, NOW, cursor, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of(affected(secondBooking))));

        // when
        announcements.on(new FacilityEvent.OpeningHoursSet(
                UUID.randomUUID(), DayOfWeek.MONDAY.getValue(), window.opensAt(), window.closesAt()));

        // then
        var ordered = inOrder(impact, events);
        ordered.verify(impact).pageOfOpeningHours(DayOfWeek.MONDAY, window, NOW, null, 100);
        ordered.verify(events).publishEvent(
                new BookingDisplaced(firstBooking, BookingDisplaced.Closure.HOURS_NARROWED));
        ordered.verify(impact).pageOfOpeningHours(DayOfWeek.MONDAY, window, NOW, cursor, 100);
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
                impact, events, Clock.fixed(NOW, ZoneOffset.UTC));
        UUID courtId = UUID.randomUUID();
        UUID cardId = UUID.randomUUID();
        when(impact.pageOfDeactivating(courtId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));
        when(impact.pageOfRetiringCard(cardId, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));
        when(impact.pageOfClosingWeekday(DayOfWeek.TUESDAY, NOW, null, 100))
                .thenReturn(new ImpactService.ImpactPage(null, List.of()));

        // when
        announcements.on(new FacilityEvent.CourtAvailabilityChanged(courtId, false));
        announcements.on(new CardEvent.BookingCardAvailabilityChanged(cardId, false));
        announcements.on(new FacilityEvent.OpeningHoursClosed(UUID.randomUUID(), DayOfWeek.TUESDAY.getValue()));

        // then
        verify(impact).pageOfDeactivating(courtId, NOW, null, 100);
        verify(impact).pageOfRetiringCard(cardId, NOW, null, 100);
        verify(impact).pageOfClosingWeekday(DayOfWeek.TUESDAY, NOW, null, 100);
    }

    private static ImpactService.AffectedBooking affected(UUID bookingId) {
        return new ImpactService.AffectedBooking(
                bookingId, List.of(UUID.randomUUID()), NOW.plusSeconds(3600), NOW.plusSeconds(7200));
    }
}
