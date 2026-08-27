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
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class PersonBookingHistoryTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final String GUEST = "Richard Miles";
    private static final String NOTE = "Doubles against the neighbours";

    @Autowired
    private PersonBookingHistory history;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingRepository bookingRows;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private UUID courtId;
    private UUID bookerAccountId;
    private UUID bookerPersonId;
    private UUID namedPersonId;
    private UUID otherPersonId;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "jane.doe", Set.of(Role.MEMBER));
        namedPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        otherPersonId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenAMemberMadeABooking_whenTheirHistoryIsRead_thenItHoldsTheCourtAndTimeAndNobodyElse() {
        // given
        UUID bookingId = bookingByJane();

        // when
        List<PersonBookingHistory.Made> made = history.madeBy(bookerAccountId);

        // then
        assertThat(made).singleElement().satisfies(booking -> {
            assertThat(booking.bookingId()).isEqualTo(bookingId);
            assertThat(booking.status()).isEqualTo(BookingStatus.CONFIRMED);
            assertThat(booking.note()).isEqualTo(NOTE);
            assertThat(booking.reservations()).containsExactly(
                    new PersonBookingHistory.Reservation(courtId, SIX_PM, SEVEN_PM));
        });
        assertThat(made.getFirst().toString())
                .as("the people a member played with are not part of the answer about that member")
                .doesNotContain(namedPersonId.toString(), otherPersonId.toString(), GUEST);
    }

    @Test
    void givenAMemberRecordedInSomebodyElsesBooking_whenTheirHistoryIsRead_thenItNamesNeitherMakerNorNote() {
        // given
        UUID bookingId = bookingByJane();

        // when
        List<PersonBookingHistory.Recorded> recorded = history.recordedIn(namedPersonId);

        // then
        assertThat(recorded).singleElement().satisfies(booking -> {
            assertThat(booking.bookingId()).isEqualTo(bookingId);
            assertThat(booking.reservations()).containsExactly(
                    new PersonBookingHistory.Reservation(courtId, SIX_PM, SEVEN_PM));
        });
        assertThat(recorded.getFirst().toString())
                .as("somebody else made this booking, and their words and their identity are theirs")
                .doesNotContain(NOTE, bookerAccountId.toString(), bookerPersonId.toString(),
                        otherPersonId.toString(), GUEST);
    }

    @Test
    void givenAMemberWhoNeitherBookedNorWasNamed_whenTheirHistoryIsRead_thenBothListsAreEmpty() {
        // given
        bookingByJane();
        UUID strangerPersonId = identity.createPerson("Ada", "Stranger", "ada.stranger@example.org");
        UUID strangerAccountId = identity.createEnabledAccount(
                strangerPersonId, "ada.stranger", Set.of(Role.MEMBER));

        // when / then
        assertThat(history.madeBy(strangerAccountId)).isEmpty();
        assertThat(history.recordedIn(strangerPersonId)).isEmpty();
    }

    @Test
    void whenABookingHistoryIsReadWithoutAnIdentifier_thenItRefusesRatherThanAnsweringWithEverybodys() {
        // given — a booking an import brought in carries no booker, and a guest carries no person
        Booking imported = new Booking(MEMBER_BOOKING_CARD, null, NOTE, SIX_PM);
        imported.allocate(courtId, new TimeSlot(SIX_PM, SEVEN_PM));
        imported.addParticipant(ParticipantSpec.guest(GUEST));
        bookingRows.saveAndFlush(imported);

        // when / then
        assertThatThrownBy(() -> history.madeBy(null)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> history.recordedIn(null)).isInstanceOf(IllegalStateException.class);
    }

    private UUID bookingByJane() {
        return bookings.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                bookerAccountId, bookerPersonId, Set.of(Role.MEMBER), NOTE,
                List.of(ParticipantSpec.member(namedPersonId), ParticipantSpec.member(otherPersonId),
                        ParticipantSpec.guest(GUEST)), null));
    }
}
