package org.courtside.booking;

import org.courtside.booking.internal.ParticipantKind;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(FacilityTestFixture.class)
class ParticipantCardBookingTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID PARTNER_WANTED =
            UUID.fromString("66666666-6666-6666-6666-666666666666");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-13T18:00:00Z");

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @AfterEach
    void reactivateCards() {
        jdbc.sql("UPDATE participant_card SET active = true").update();
    }

    @Test
    void givenOneMemberAndTheBallMachine_whenBooking_thenTwoParticipantSlotsAreValid() {
        // when
        UUID bookingId = book(List.of(ParticipantSpec.card(BALL_MACHINE)));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(2)
                .last()
                .satisfies(participant -> {
                    assertThat(participant.getKind()).isEqualTo(ParticipantKind.CARD);
                    assertThat(participant.getCardId()).isEqualTo(BALL_MACHINE);
                });
    }

    @Test
    void givenThreeMembersAndTheBallMachine_whenBooking_thenFourParticipantSlotsAreValid() {
        // given
        UUID second = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();
        UUID third = persons.save(new Person("Richard", "Miles", "richard@example.org")).getId();

        // when
        UUID bookingId = book(List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.member(third),
                ParticipantSpec.card(BALL_MACHINE)));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(4);
    }

    @Test
    void givenAnOpenSlotMarkedPartnerWanted_whenBooking_thenItIsAccepted() {
        // when
        UUID bookingId = book(List.of(ParticipantSpec.card(PARTNER_WANTED)));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(2);
    }

    @Test
    void givenAnUnknownCard_whenBooking_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> book(List.of(ParticipantSpec.card(UUID.randomUUID()))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.unknownCard");
    }

    @Test
    void givenADeactivatedCard_whenBooking_thenItIsRejected() {
        // given
        jdbc.sql("UPDATE participant_card SET active = false WHERE id = :id")
                .param("id", BALL_MACHINE)
                .update();

        // when / then
        assertThatThrownBy(() -> book(List.of(ParticipantSpec.card(BALL_MACHINE))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.unknownCard");
    }

    @Test
    void givenAFourPlayerBookingNamingTheBallMachineTwice_whenBooking_thenItIsRejected() {
        // given
        UUID second = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();

        // when / then
        assertThatThrownBy(() -> book(List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.card(BALL_MACHINE),
                ParticipantSpec.card(BALL_MACHINE))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.cardUnavailable");
    }

    @Test
    void givenTheBallMachineAlreadyBookedOnAnotherCourt_whenBookingItAtTheSameHour_thenItIsRejected() {
        // given
        UUID otherCourt = facilityFixture.createCourt(3, "Court 3");
        book(List.of(ParticipantSpec.card(BALL_MACHINE)));

        // when / then
        assertThatThrownBy(() -> bookOnCourt(otherCourt, List.of(ParticipantSpec.card(BALL_MACHINE))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.cardUnavailable");
    }

    @Test
    void givenTwoOpenSlotsMarkedPartnerWanted_whenBooking_thenBothAreAccepted() {
        // given
        UUID second = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();

        // when
        UUID bookingId = book(List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.card(PARTNER_WANTED),
                ParticipantSpec.card(PARTNER_WANTED)));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(4);
    }

    @Test
    void givenTheBallMachineBookedAtSixPm_whenBookingItAtSevenPmOnAnotherCourt_thenItIsAccepted() {
        // given
        UUID otherCourt = facilityFixture.createCourt(3, "Court 3");
        book(List.of(ParticipantSpec.card(BALL_MACHINE)));

        // when
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(otherCourt), MEMBER_BOOKING_CARD, new TimeSlot(SEVEN_PM, EIGHT_PM),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.card(BALL_MACHINE)), null));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(2);
    }

    @Test
    void givenOneCardParticipantAcrossTwoOverlappingCourtAllocations_whenCountingCardUsage_thenTheCardIsCountedOnce() {
        // given
        UUID secondCourt = facilityFixture.createCourt(2, "Court 2");
        Booking booking = new Booking(MEMBER_BOOKING_CARD, bookerPersonId, null, SIX_PM);
        booking.allocate(courtId, new TimeSlot(SIX_PM, SEVEN_PM));
        booking.allocate(secondCourt, new TimeSlot(SIX_PM, SEVEN_PM));
        booking.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        bookings.saveAndFlush(booking);

        // when
        long usage = bookings.countCardUsageOverlapping(BALL_MACHINE, SIX_PM, SEVEN_PM);

        // then
        assertThat(usage).isOne();
    }

    private UUID bookOnCourt(UUID court, List<ParticipantSpec> participants) {
        return bookingService.create(new CreateBookingCommand(
                List.of(court), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null, participants, null));
    }

    private UUID book(List<ParticipantSpec> participants) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null, participants, null));
    }
}
