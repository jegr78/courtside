package org.courtside.booking;

import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingSlotCountTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    private UUID courtId;
    private UUID bookerPersonId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenOneFurtherPlayer_whenBooking_thenTheBookerFillsSlotOneAndTwoPlayersAreComplete() {
        // when
        UUID bookingId = book(MEMBER_BOOKING_CARD, List.of(ParticipantSpec.guest("John Roe")));

        // then
        List<BookingParticipant> participants =
                bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants();
        assertThat(participants).hasSize(2);
        assertThat(participants.getFirst().getPersonId()).isEqualTo(bookerPersonId);
        assertThat(participants.getFirst().getPosition()).isEqualTo(1);
    }

    @Test
    void givenThreeFurtherPlayers_whenBooking_thenFourPlayersAreComplete() {
        // given
        UUID second = identity.createPerson("Mary", "Major", "mary@example.org");
        UUID third = identity.createPerson("Richard", "Miles", "richard@example.org");

        // when
        UUID bookingId = book(MEMBER_BOOKING_CARD, List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.member(third),
                ParticipantSpec.guest("John Roe")));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(4);
    }

    @Test
    void givenThreeGuestsWithoutPersonIds_whenBooking_thenTheDuplicateCheckDoesNotFalselyFire() {
        // when
        UUID bookingId = book(MEMBER_BOOKING_CARD, List.of(
                ParticipantSpec.guest("John Roe"),
                ParticipantSpec.guest("Richard Miles"),
                ParticipantSpec.guest("Mary Major")));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .hasSize(4);
    }

    @Test
    void givenTwoFurtherPlayers_whenBooking_thenThreeSlotsAreRejected() {
        // given
        UUID second = identity.createPerson("Mary", "Major", "mary@example.org");

        // when / then
        assertThatThrownBy(() -> book(MEMBER_BOOKING_CARD, List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.guest("John Roe"))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.slotCount");
    }

    @Test
    void givenNoFurtherPlayers_whenBookingAMemberCard_thenOneSlotIsRejected() {
        // when / then
        assertThatThrownBy(() -> book(MEMBER_BOOKING_CARD, List.of()))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.slotCount");
    }

    @Test
    void givenATrainingCard_whenBookingWithoutPlayers_thenNoParticipantIsStored() {
        // when
        UUID bookingId = bookAs(TRAINING_CARD, Role.TRAINER, List.of());

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .isEmpty();
    }

    @Test
    void givenATrainingCard_whenBookingWithPlayers_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> bookAs(TRAINING_CARD, Role.TRAINER,
                List.of(ParticipantSpec.guest("John Roe"))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.notTracked");
    }

    @Test
    void givenNoPersonBehindTheAccount_whenBookingAMemberCard_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), null, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("John Roe")), null)))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.bookerUnknown");
    }

    @Test
    void givenTheBookerAlsoListedAsAParticipant_whenBooking_thenTheDuplicateIsRejected() {
        // given
        UUID third = identity.createPerson("Richard", "Miles", "richard@example.org");

        // when / then
        assertThatThrownBy(() -> book(MEMBER_BOOKING_CARD, List.of(
                ParticipantSpec.member(bookerPersonId),
                ParticipantSpec.member(third),
                ParticipantSpec.guest("John Roe"))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.duplicate");
    }

    @Test
    void givenAFourPlayerBookingNamingAnUnknownPersonId_whenBooking_thenItIsRejected() {
        // given
        UUID second = identity.createPerson("Mary", "Major", "mary@example.org");

        // when / then
        assertThatThrownBy(() -> book(MEMBER_BOOKING_CARD, List.of(
                ParticipantSpec.member(second),
                ParticipantSpec.member(UUID.randomUUID()),
                ParticipantSpec.guest("John Roe"))))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.unknownPerson");
    }

    private UUID book(UUID cardId, List<ParticipantSpec> participants) {
        return bookAs(cardId, Role.MEMBER, participants);
    }

    private UUID bookAs(UUID cardId, Role role, List<ParticipantSpec> participants) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), bookerPersonId, Set.of(role), null, participants, null));
    }
}
