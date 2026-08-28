package org.courtside.booking.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.internal.BookingReminders;
import org.courtside.booking.series.BookingSeries;
import org.courtside.booking.series.BookingSeriesRepository;
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

    public UUID createBookingNamingMember(UUID courtId, UUID cardId, TimeSlot slot, UUID bookedBy,
                                          UUID bookerPersonId, Set<Role> roles, String note,
                                          UUID namedPersonId) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, slot, bookedBy, bookerPersonId, roles, note,
                List.of(ParticipantSpec.member(namedPersonId)), null));
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
