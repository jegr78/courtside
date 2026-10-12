package org.courtside.booking.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.internal.BookingReminders;
import org.courtside.booking.series.BookingSeries;
import org.courtside.booking.series.BookingSeriesRepository;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@RequiredArgsConstructor
public class BookingTestFixture {

    private final BookingService bookingService;
    private final BookingRepository bookings;
    private final BookingReminders reminders;
    private final BookingSeriesRepository seriesRows;
    private final SeriesService seriesService;

    public UUID createBookingWithGuest(UUID courtId, UUID cardId, TimeSlot slot,
                                       UUID bookerPersonId, Set<Role> roles, String guestName) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, slot, UUID.randomUUID(), bookerPersonId, roles, null,
                List.of(ParticipantSpec.guest(guestName)), null));
    }

    public UUID createBookingWithGuest(UUID courtId, UUID cardId, TimeSlot slot, UUID bookedBy,
                                       UUID bookerPersonId, Set<Role> roles, String note,
                                       String guestName) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, slot, bookedBy, bookerPersonId, roles, note,
                List.of(ParticipantSpec.guest(guestName)), null));
    }

    public UUID createBookingOnCourts(List<UUID> courtIds, UUID cardId, TimeSlot slot,
                                      UUID bookerPersonId, Set<Role> roles) {
        return bookingService.create(new CreateBookingCommand(
                courtIds, cardId, slot, UUID.randomUUID(), bookerPersonId, roles, null, List.of(), null));
    }

    public void cancelBooking(UUID bookingId, UUID cancelledBy, Set<Role> roles) {
        bookingService.cancel(bookingId, cancelledBy, roles);
    }

    public UUID createSeries(UUID courtId, UUID cardId, java.time.LocalDate startsOn,
                             java.time.LocalTime startTime, int durationMinutes, int occurrences,
                             UUID bookedBy, UUID bookerPersonId, Set<Role> roles) {
        SeriesRule rule = new SeriesRule(List.of(courtId), cardId, startsOn, startTime, durationMinutes,
                1, Set.of(startsOn.getDayOfWeek()), null, occurrences);
        List<java.time.Instant> starts = seriesService.preview(rule, bookedBy, bookerPersonId, roles)
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, bookedBy, bookerPersonId, roles, null).seriesId();
    }

    public UUID createBookingNamingMember(UUID courtId, UUID cardId, TimeSlot slot, UUID bookedBy,
                                          UUID bookerPersonId, Set<Role> roles, String note,
                                          UUID namedPersonId) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, slot, bookedBy, bookerPersonId, roles, note,
                List.of(ParticipantSpec.member(namedPersonId)), null));
    }

    public void moveWholeSeries(UUID seriesId, java.time.LocalTime newStartTime, UUID movedBy, Set<Role> roles) {
        seriesService.move(new MoveRequest(seriesId, firstOccurrenceOf(seriesId), CancelScope.WHOLE_SERIES,
                newStartTime, null, null), movedBy, roles);
    }

    public UUID firstOccurrenceOf(UUID seriesId) {
        return bookings.findConfirmedBySeriesOrderedByStart(seriesId).getFirst().getId();
    }

    // The row a recurring booking leaves behind, without the preview the creation path needs:
    // what an answer about a person reads is this row and not how it was arrived at.
    public UUID recordSeries(UUID courtId, UUID cardId, java.time.LocalDate startsOn,
                             java.time.LocalTime startTime, int durationMinutes,
                             java.util.Set<java.time.DayOfWeek> weekdays, int occurrences,
                             UUID createdBy, String note, java.time.Instant createdAt) {
        SeriesRule rule = new SeriesRule(List.of(courtId), cardId, startsOn, startTime,
                durationMinutes, 1, weekdays, null, occurrences);
        return seriesRows.save(new BookingSeries(rule, createdBy, note, createdAt)).getId();
    }

    // What the scheduler calls, so a test elsewhere can watch what a due reminder produces
    // without reaching into this module.
    public void remindWhatIsDue() {
        reminders.remindWhatIsDue();
    }

    public boolean isConfirmed(UUID bookingId) {
        return booking(bookingId).getStatus() == BookingStatus.CONFIRMED;
    }

    public UUID cardIdOf(UUID bookingId) {
        return booking(bookingId).getCardId();
    }

    public long countBookings() {
        return bookings.count();
    }

    private Booking booking(UUID bookingId) {
        return bookings.findById(bookingId).orElseThrow();
    }
}
