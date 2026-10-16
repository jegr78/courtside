package org.courtside.booking.attendance;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({AuditTestFixture.class, BookingTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class})
class AttendanceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private AttendanceService attendance;

    @Autowired
    private AttendanceRelease release;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private BookingRepository bookingRows;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID member;
    private UUID board;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        member = identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane@example.org"), "jane",
                Set.of(Role.MEMBER));
        board = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "mary",
                Set.of(Role.ADMIN));
    }

    @Test
    void givenTheClubRecordsNoAttendance_whenTheBoardRecordsANoShow_thenItIsRefusedAsNotTracked() {
        // given
        UUID booking = startingMinutesFromNow(-90, MEMBER_BOOKING_CARD);

        // when / then
        assertThatThrownBy(() -> attendance.record(booking, AttendanceOutcome.NO_SHOW, board))
                .isInstanceOf(AttendanceNotTrackedException.class)
                .hasMessage("attendance.notTracked");
    }

    @Test
    void givenABookingThatHasNotStarted_whenTheBoardRecordsANoShow_thenItIsRefusedAsNotRecordable() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(30, MEMBER_BOOKING_CARD);

        // when / then
        assertThatThrownBy(() -> attendance.record(booking, AttendanceOutcome.NO_SHOW, board))
                .isInstanceOf(AttendanceNotRecordableException.class)
                .hasMessage("attendance.notRecordable");
    }

    @Test
    void givenABookingCancelledBeforeItsStart_whenTheBoardRecordsANoShow_thenItIsRefusedAsNotRecordable() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(-90, MEMBER_BOOKING_CARD);
        jdbc.sql("UPDATE booking SET status = 'CANCELLED', cancelled_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(NOW.minus(2, ChronoUnit.DAYS))).param("id", booking).update();

        // when / then
        assertThatThrownBy(() -> attendance.record(booking, AttendanceOutcome.NO_SHOW, board))
                .as("nobody was expected at a booking cancelled the day before")
                .isInstanceOf(AttendanceNotRecordableException.class);
    }

    @Test
    void givenAStartedBooking_whenTheBoardRecordsANoShowAndThenClearsIt_thenBothAreAuditedAndNothingRemains() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(-90, MEMBER_BOOKING_CARD);

        // when
        attendance.record(booking, AttendanceOutcome.NO_SHOW, board);
        AttendanceOutcome recorded = attendance.outcomeOf(booking).orElseThrow();
        attendance.clear(booking);

        // then
        assertThat(recorded).isEqualTo(AttendanceOutcome.NO_SHOW);
        assertThat(attendance.outcomeOf(booking)).as("a cleared attendance is unrecorded again").isEmpty();
        assertThat(eventTypesAbout(booking))
                .as("the fixed clock gives both the same instant").containsExactlyInAnyOrder("booking.attendance.recorded", "booking.attendance.cleared");
    }

    @Test
    void givenTheCheckInWindowIsOpen_whenTheMemberChecksIn_thenTheBookingIsRecordedAsAttended() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(10, MEMBER_BOOKING_CARD);

        // when
        attendance.checkIn(booking, member);
        attendance.checkIn(booking, member);

        // then
        assertThat(attendance.outcomeOf(booking)).contains(AttendanceOutcome.ATTENDED);
        assertThat(eventTypesAbout(booking)).as("checking in again changes nothing")
                .containsExactly("booking.attendance.recorded");
    }

    @Test
    void givenABookingStartingInAnHour_whenTheMemberChecksIn_thenTheWindowIsClosed() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(60, MEMBER_BOOKING_CARD);

        // when / then
        assertThatThrownBy(() -> attendance.checkIn(booking, member))
                .isInstanceOf(CheckInClosedException.class)
                .hasMessage("attendance.checkIn.closed");
    }

    @Test
    void givenARecordedNoShow_whenTheMemberChecksInBeforeTheEnd_thenTheNoShowStands() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(-30, MEMBER_BOOKING_CARD);
        attendance.record(booking, AttendanceOutcome.NO_SHOW, board);

        // when / then
        assertThatThrownBy(() -> attendance.checkIn(booking, member))
                .isInstanceOf(CheckInClosedException.class);
        assertThat(attendance.outcomeOf(booking)).contains(AttendanceOutcome.NO_SHOW);
    }

    @Test
    void givenSomebodyElsesBooking_whenAMemberChecksIn_thenItIsAnsweredLikeABookingThatDoesNotExist() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(5, MEMBER_BOOKING_CARD);

        // when / then
        assertThatThrownBy(() -> attendance.checkIn(booking, board))
                .isInstanceOf(BookingNotFoundException.class);
        assertThat(attendance.outcomeOf(booking)).isEmpty();
    }

    @Test
    void givenAReleaseTime_whenNobodyCheckedInByThen_thenTheBookingIsCancelledItsCourtFreedAndTheReleaseAudited() {
        // given
        bookings.trackAttendance(15);
        UUID due = startingMinutesFromNow(-20, MEMBER_BOOKING_CARD);
        UUID notYet = startingMinutesFromNow(-10, MEMBER_BOOKING_CARD, 2);

        // when
        int released = release.releaseDue();

        // then
        assertThat(released).isEqualTo(1);
        assertThat(bookingRows.findById(due).orElseThrow().getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(bookingRows.findById(notYet).orElseThrow().getStatus())
                .as("ten minutes after its start a 15-minute release time has not passed")
                .isEqualTo(BookingStatus.CONFIRMED);
        assertThat(attendance.releasedAmong(Set.of(due, notYet))).containsExactly(due);
        assertThat(allocationStatusOf(due)).as("the court is free again").isEqualTo("CANCELLED");
        assertThat(eventTypesAbout(due)).containsExactly("booking.attendance.released");
        assertThat(attendance.outcomeOf(due)).as("a release records no no-show").isEmpty();
    }

    @Test
    void givenAReleaseTime_whenTheMemberCheckedIn_thenTheBookingStands() {
        // given
        bookings.trackAttendance(15);
        UUID booking = startingMinutesFromNow(-20, MEMBER_BOOKING_CARD);
        attendance.checkIn(booking, member);

        // when
        int released = release.releaseDue();

        // then
        assertThat(released).isZero();
        assertThat(bookingRows.findById(booking).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenAReleaseTime_whenATrainingNobodyCheckedInForHasStarted_thenOnlyMemberBookingsAreReleased() {
        // given
        bookings.trackAttendance(15);
        UUID training = startingMinutesFromNow(-20, TRAINING_CARD);

        // when
        int released = release.releaseDue();

        // then
        assertThat(released).as("a card that does not count against limits is not a member booking").isZero();
        assertThat(bookingRows.findById(training).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenNoReleaseTime_whenABookingNobodyCheckedInForRuns_thenNothingIsReleased() {
        // given
        bookings.trackAttendance(null);
        UUID booking = startingMinutesFromNow(-50, MEMBER_BOOKING_CARD);

        // when
        int released = release.releaseDue();

        // then
        assertThat(released).isZero();
        assertThat(bookingRows.findById(booking).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void whenAReleaseTimeIsSetWithoutAttendance_thenThePolicyIsRefused() {
        // when / then
        assertThatThrownBy(() -> new AttendancePolicy(false, 15))
                .isInstanceOf(AttendancePolicyInvalidException.class)
                .hasMessage("attendance.policy.releaseNeedsAttendance");
    }

    @Test
    void givenThePolicyChanges_whenSavedTwice_thenOnlyTheChangeIsAudited() {
        // when
        attendance.changePolicy(new AttendancePolicy(true, 15));
        attendance.changePolicy(new AttendancePolicy(true, 15));

        // then
        assertThat(attendance.policy()).isEqualTo(new AttendancePolicy(true, 15));
        assertThat(eventTypesAbout(AttendanceRows.POLICY_ID)).containsExactly("booking.attendance.policyChanged");
    }

    private UUID startingMinutesFromNow(int minutes, UUID cardId) {
        return startingMinutesFromNow(minutes, cardId, 1);
    }

    private UUID startingMinutesFromNow(int minutes, UUID cardId, int courtNumber) {
        UUID court = courtNumber == 1 ? courtId : facility.createCourt(courtNumber, "Court " + courtNumber);
        Instant start = NOW.plus(minutes, ChronoUnit.MINUTES);
        return bookings.insertBookingThatHasStarted(court, cardId, new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                member);
    }

    private List<String> eventTypesAbout(UUID subject) {
        return audit.eventsAbout(subject).stream().map(AuditTestFixture.RecordedEvent::eventType).toList();
    }

    private String allocationStatusOf(UUID booking) {
        return jdbc.sql("SELECT status FROM court_allocation WHERE booking_id = :id").param("id", booking)
                .query(String.class).single();
    }
}
