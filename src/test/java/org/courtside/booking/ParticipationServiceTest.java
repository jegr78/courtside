package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ParticipationServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final int PAGE_LIMIT = 50;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    private UUID courtId;
    private UUID bookerAccountId;
    private UUID bookerPersonId;
    private UUID namedPersonId;
    private UUID namedAccountId;

    @BeforeEach
    void setUp() {
        courtId = courts.save(new Court(1, "Court 1")).getId();
        bookerAccountId = UUID.randomUUID();
        bookerPersonId = persons.save(new Person("Jane", "Doe", "jane.doe@example.org")).getId();
        namedAccountId = UUID.randomUUID();
        namedPersonId = persons.save(new Person("John", "Roe", "john.roe@example.org")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
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
        UUID strangerPersonId = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();

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

    private UUID bookingByJaneNaming(UUID participantPersonId) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                bookerAccountId, bookerPersonId, Set.of(Role.MEMBER), "Doubles",
                List.of(ParticipantSpec.member(participantPersonId)), null));
    }
}
