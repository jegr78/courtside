package org.courtside.booking;

import org.courtside.booking.internal.ParticipantKind;
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
class BookingParticipantTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");

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
    void givenAGuestParticipant_whenBooking_thenItIsStoredAsAGuest() {
        // when
        UUID bookingId = book(List.of(ParticipantSpec.guest("John Roe")));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .last()
                .satisfies(participant -> {
                    assertThat(participant.getKind()).isEqualTo(ParticipantKind.GUEST);
                    assertThat(participant.getGuestName()).isEqualTo("John Roe");
                });
    }

    @Test
    void givenACardParticipant_whenBooking_thenItIsStoredAsACard() {
        // when
        UUID bookingId = book(List.of(ParticipantSpec.card(BALL_MACHINE)));

        // then
        assertThat(bookings.findWithParticipantsById(bookingId).orElseThrow().getParticipants())
                .last()
                .satisfies(participant -> {
                    assertThat(participant.getKind()).isEqualTo(ParticipantKind.CARD);
                    assertThat(participant.getCardId()).isEqualTo(BALL_MACHINE);
                });
    }

    @Test
    void whenBuildingASpecFromAPersonId_thenItIsAMemberSpec() {
        // when
        ParticipantSpec spec = ParticipantSpec.from(bookerPersonId, null, null);

        // then
        assertThat(spec.kind()).isEqualTo(ParticipantKind.MEMBER);
        assertThat(spec.personId()).isEqualTo(bookerPersonId);
    }

    @Test
    void whenBuildingASpecFromNothing_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> ParticipantSpec.from(null, null, null))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.invalid");
    }

    @Test
    void whenBuildingASpecFromTwoFillers_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> ParticipantSpec.from(bookerPersonId, "John Roe", null))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.invalid");
    }

    @Test
    void whenBuildingASpecFromABlankGuestName_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> ParticipantSpec.from(null, "  ", null))
                .isInstanceOf(ParticipantsInvalidException.class)
                .extracting("code")
                .isEqualTo("booking.participants.invalid");
    }

    private UUID book(List<ParticipantSpec> participants) {
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null, participants, null));
    }
}
