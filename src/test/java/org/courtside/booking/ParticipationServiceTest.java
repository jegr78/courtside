package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class ParticipationServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant TWO_PM = Instant.parse("2026-05-13T14:00:00Z");
    private static final Instant THREE_PM = Instant.parse("2026-05-13T15:00:00Z");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant LAST_WEEK = Instant.parse("2026-05-05T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final int PAGE_LIMIT = 50;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identityFixture;

    private UUID courtId;
    private UUID bookerAccountId;
    private UUID bookerPersonId;
    private UUID namedPersonId;
    private UUID namedAccountId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerAccountId = UUID.randomUUID();
        bookerPersonId = identityFixture.createPerson("Jane", "Doe", "jane.doe@example.org");
        namedAccountId = UUID.randomUUID();
        namedPersonId = identityFixture.createPerson("John", "Roe", "john.roe@example.org");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenAMemberNamedInSomebodyElsesBooking_whenTheyListTheirParticipations_thenTheyFindIt() {
        // given
        UUID bookingId = bookingByJaneNaming(namedPersonId);

        // when
        ParticipationPage page = participations.participations(
                namedPersonId, namedAccountId, null, PAGE_LIMIT);

        // then
        assertThat(page.bookings())
                .as("a member is recorded without being asked, so the list is how they find out")
                .extracting(Booking::getId)
                .containsExactly(bookingId);
    }

    @Test
    void givenAMemberWhoMadeTheBooking_whenTheyListTheirParticipations_thenTheirOwnIsNotAmongThem() {
        // given
        bookingByJaneNaming(namedPersonId);

        // when
        ParticipationPage page = participations.participations(
                bookerPersonId, bookerAccountId, null, PAGE_LIMIT);

        // then
        assertThat(page.bookings())
                .as("the booker is recorded as participant one of their own booking, and a booking"
                        + " somebody made themselves is not something they were named in")
                .isEmpty();
    }

    @Test
    void givenAMemberNamedInSomebodyElsesBooking_whenTheyWithdraw_thenTheBookingKeepsEverythingElse() {
        // given
        UUID bookingId = bookingByJaneNaming(namedPersonId);

        // when
        participations.withdraw(bookingId, namedPersonId, namedAccountId);

        // then
        Booking booking = bookings.findWithParticipantsById(bookingId).orElseThrow();
        assertThat(booking.getParticipants())
                .extracting(BookingParticipant::getPersonId)
                .as("the objection removes the member's place, not the booking")
                .containsExactly(bookerPersonId);
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(bookings.findAllByIdIn(List.of(bookingId)).getFirst().getAllocations())
                .as("the court stays occupied; only the name goes")
                .hasSize(1);
    }

    @Test
    void givenAMemberNobodyNamed_whenTheyWithdrawFromABooking_thenItIsRefused() {
        // given
        UUID bookingId = bookingByJaneNaming(namedPersonId);
        UUID strangerPersonId = identityFixture.createPerson("Mary", "Major", "mary@example.org");

        // when / then
        assertThatThrownBy(() -> participations.withdraw(bookingId, strangerPersonId, UUID.randomUUID()))
                .isInstanceOf(ParticipationNotFoundException.class);
    }

    @Test
    void givenAMemberWhoAlreadyWithdrew_whenTheyWithdrawAgain_thenItIsRefused() {
        // given
        UUID bookingId = bookingByJaneNaming(namedPersonId);
        participations.withdraw(bookingId, namedPersonId, namedAccountId);

        // when / then
        assertThatThrownBy(() -> participations.withdraw(bookingId, namedPersonId, namedAccountId))
                .isInstanceOf(ParticipationNotFoundException.class);
    }

    @Test
    void givenTheirOwnBooking_whenTheBookerWithdrawsFromIt_thenItIsRefused() {
        // given
        UUID bookingId = bookingByJaneNaming(namedPersonId);

        // when / then
        assertThatThrownBy(() -> participations.withdraw(bookingId, bookerPersonId, bookerAccountId))
                .as("leaving a booking one made oneself is cancelling it, and that has its own"
                        + " operation with its own rules")
                .isInstanceOf(ParticipationNotFoundException.class);
    }

    @Test
    void givenSeveralParticipations_whenTheyArePagedOneAtATime_thenEachIsWalkedExactlyOnce() {
        // given
        UUID secondCourt = facilityFixture.createCourt(2, "Court 2");
        UUID earlier = bookingNaming(namedPersonId, courtId, new TimeSlot(TWO_PM, THREE_PM));
        UUID onOneCourt = bookingNaming(namedPersonId, courtId, new TimeSlot(SIX_PM, SEVEN_PM));
        UUID onTheOther = bookingNaming(namedPersonId, secondCourt, new TimeSlot(SIX_PM, SEVEN_PM));

        // when
        List<UUID> walked = new ArrayList<>();
        UUID cursor = null;
        for (int page = 0; page < 3; page += 1) {
            ParticipationPage current =
                    participations.participations(namedPersonId, namedAccountId, cursor, 1);
            walked.addAll(current.bookings().stream().map(Booking::getId).toList());
            cursor = current.nextCursor();
        }

        // then
        assertThat(walked)
                .as("two of them start at the same moment, so a page boundary falls inside the"
                        + " tie the cursor breaks by id")
                .containsExactlyInAnyOrder(earlier, onOneCourt, onTheOther);
        assertThat(walked.getLast()).isEqualTo(earlier);
        assertThat(cursor).isNull();
    }

    @Test
    void givenABookingThatHasAlreadyHappened_whenTheNamedMemberObjects_thenTheRecordGoesAnyway() {
        // given
        Booking past = new Booking(MEMBER_BOOKING_CARD, UUID.randomUUID(), null, THREE_PM);
        past.allocate(courtId, new TimeSlot(LAST_WEEK, LAST_WEEK.plusSeconds(3600)));
        past.addParticipant(ParticipantSpec.member(bookerPersonId));
        past.addParticipant(ParticipantSpec.member(namedPersonId));
        bookings.saveAndFlush(past);

        // when
        participations.withdraw(past.getId(), namedPersonId, namedAccountId);

        // then
        assertThat(bookings.findWithParticipantsById(past.getId()).orElseThrow().getParticipants())
                .as("a member usually learns of the record after the fact, so a booking that has"
                        + " already happened is the case the objection exists for")
                .extracting(BookingParticipant::getPersonId)
                .containsExactly(bookerPersonId);
    }

    private UUID bookingByJaneNaming(UUID participantPersonId) {
        return bookingNaming(participantPersonId, courtId, new TimeSlot(SIX_PM, SEVEN_PM));
    }

    private UUID bookingNaming(UUID participantPersonId, UUID court, TimeSlot slot) {
        return bookingService.create(new CreateBookingCommand(
                List.of(court), MEMBER_BOOKING_CARD, slot,
                bookerAccountId, bookerPersonId, Set.of(Role.MEMBER), "Doubles",
                List.of(ParticipantSpec.member(participantPersonId)), null));
    }
}
