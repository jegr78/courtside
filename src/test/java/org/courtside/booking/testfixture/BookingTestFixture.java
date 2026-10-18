package org.courtside.booking.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.attendance.AttendanceOutcome;
import org.courtside.booking.attendance.AttendancePolicy;
import org.courtside.booking.attendance.AttendanceRelease;
import org.courtside.booking.attendance.AttendanceService;
import org.courtside.booking.internal.BookingReminders;
import org.courtside.booking.series.BookingSeries;
import org.courtside.booking.series.BookingSeriesRepository;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.waitlist.JoinWaitlistCommand;
import org.courtside.booking.waitlist.WaitlistService;
import org.courtside.booking.partner.PartnerSearchService;
import org.courtside.card.ParticipantCard;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.identity.Role;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.TimeSlot;

import org.springframework.jdbc.core.simple.JdbcClient;

import java.sql.Timestamp;
import java.time.Duration;
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
    private final WaitlistService waitlist;
    private final PartnerSearchService partnerSearch;
    private final AttendanceService attendance;
    private final AttendanceRelease release;
    private final JdbcClient jdbc;

    public UUID createBookingLookingForAPartner(UUID courtId, UUID cardId, TimeSlot slot, UUID bookedBy,
                                                UUID bookerPersonId) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), cardId, slot, bookedBy, bookerPersonId,
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)), null));
    }

    public UUID createBookingForDependant(UUID courtId, UUID cardId, TimeSlot slot, UUID dependantAccountId,
                                          UUID dependantPersonId, UUID guardianAccountId) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), cardId, slot, dependantAccountId,
                dependantPersonId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)), null, guardianAccountId));
    }

    public UUID publishOpenPlace(UUID bookingId, UUID holderAccountId) {
        return partnerSearch.publish(bookingId, holderAccountId);
    }

    public UUID takeOpenPlace(UUID invitationId, UUID accountId, UUID personId) {
        return partnerSearch.accept(invitationId, accountId, personId, Set.of(Role.MEMBER));
    }

    public UUID joinWaitlist(UUID courtId, UUID cardId, TimeSlot slot, UUID accountId, UUID personId,
                             UUID playerPersonId) {
        return waitlist.join(new JoinWaitlistCommand(courtId, cardId, slot, accountId, personId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId))));
    }

    public void leaveWaitlist(UUID entryId, UUID accountId) {
        waitlist.leave(entryId, accountId);
    }

    public UUID acceptWaitlistOffer(UUID entryId, UUID accountId, UUID personId) {
        return waitlist.accept(entryId, accountId, personId, Set.of(Role.MEMBER));
    }

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
    public void cancelForTheClub(UUID bookingId, UUID boardAccountId, CancellationReason reason) {
        bookingService.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN), reason);
    }

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

    public UUID insertBookingThatHasStarted(UUID courtId, UUID cardId, TimeSlot slot, UUID bookedBy) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO booking (id, card_id, status, booked_by, created_at)
                        VALUES (:id, :cardId, 'CONFIRMED', :bookedBy, :createdAt)
                        """)
                .param("id", id).param("cardId", cardId).param("bookedBy", bookedBy)
                .param("createdAt", Timestamp.from(slot.start().minus(Duration.ofDays(1))))
                .update();
        jdbc.sql("""
                        INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (:id, :bookingId, :courtId, :startsAt, :endsAt, 'CONFIRMED')
                        """)
                .param("id", UUID.randomUUID()).param("bookingId", id).param("courtId", courtId)
                .param("startsAt", Timestamp.from(slot.start())).param("endsAt", Timestamp.from(slot.end()))
                .update();
        return id;
    }

    public void trackAttendance(Integer releaseAfterMinutes) {
        attendance.changePolicy(new AttendancePolicy(true, releaseAfterMinutes));
    }

    public int releaseUnattended() {
        return release.releaseDue();
    }

    public void stopTrackingAttendance() {
        attendance.changePolicy(new AttendancePolicy(false, null));
    }

    public void recordNoShow(UUID bookingId, UUID boardAccountId) {
        attendance.record(bookingId, AttendanceOutcome.NO_SHOW, boardAccountId);
    }

    public int liftNoShows(UUID personId, UUID boardAccountId) {
        return attendance.liftNoShows(personId, boardAccountId);
    }

    private Booking booking(UUID bookingId) {
        return bookings.findById(bookingId).orElseThrow();
    }
}
