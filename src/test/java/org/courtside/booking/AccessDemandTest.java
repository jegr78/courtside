package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.AccessDemand;
import org.courtside.shared.BookingAnnouncer;
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

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
class AccessDemandTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private BookingAnnouncer announcer;

    private List<UUID> courts;
    private UUID jane;
    private UUID janeAccount;

    @BeforeEach
    void aClubWithTwoCourts() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courts = List.of(facility.createCourt(1, "Court 1"), facility.createCourt(2, "Court 2"));
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenAGrantingCardAndAnAccessPointWithoutStaticCode_whenAskingForTheDemand_thenItNamesWindowAndAccessPoint() {
        // given
        UUID gate = facility.createAccessPoint("North gate", courts, null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("a dynamic grant needs no static code").containsOnlyKeys(booking);
        AccessDemand demand = demands.get(booking);
        assertThat(demand.startsAt()).isEqualTo(EVENING.start());
        assertThat(demand.validFrom()).as("fifteen minutes lead").isEqualTo(Instant.parse("2026-05-12T15:45:00Z"));
        assertThat(demand.validUntil()).as("fifteen minutes lag").isEqualTo(Instant.parse("2026-05-12T17:15:00Z"));
        assertThat(demand.accessPointIds()).containsExactly(gate);
    }

    @Test
    void givenACardThatGrantsNoAccess_whenAskingForTheDemand_thenThereIsNone() {
        // given
        facility.createAccessPoint("North gate", courts, null);
        UUID booking = book(courts.get(0));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("the card decides whether a booking opens doors").isEmpty();
    }

    @Test
    void givenOnlyAnInactiveAccessPoint_whenAskingForTheDemand_thenThereIsNone() {
        // given
        UUID gate = facility.createAccessPoint("North gate", courts, null);
        facility.deactivateAccessPoint(gate);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("an inactive access point is opened by nothing").isEmpty();
    }

    @Test
    void givenACancelledBooking_whenAskingForTheDemand_thenThereIsNone() {
        // given
        facility.createAccessPoint("North gate", courts, null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));
        bookings.cancelBooking(booking, janeAccount, Set.of(Role.ADMIN));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("a cancelled booking opens nothing").isEmpty();
    }

    @Test
    void givenACourtNoAccessPointServes_whenAskingForTheDemand_thenThereIsNone() {
        // given
        facility.createAccessPoint("North gate", courts.subList(0, 1), null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(1));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("court 2 lies behind no access point").isEmpty();
    }

    @Test
    void givenOnlyAnAccessPointWithAStaticCode_whenAskingForTheDemand_thenThereIsNone() {
        // given
        facility.createAccessPoint("Clubhouse door", courts, "246810");
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).as("a static code serves its access point, never a code per booking").isEmpty();
    }

    @Test
    void givenAStaticAndADynamicAccessPoint_whenAskingForTheDemand_thenOnlyTheDynamicOneIsNamed() {
        // given
        facility.createAccessPoint("Clubhouse door", courts, "246810");
        UUID gate = facility.createAccessPoint("Court gate", courts, null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));

        // when
        var demands = announcer.accessDemands(List.of(booking));

        // then
        assertThat(demands).containsOnlyKeys(booking);
        assertThat(demands.get(booking).accessPointIds()).containsExactly(gate);
    }

    @Test
    void givenBookingsInAndOutsideTheRange_whenPagingDemands_thenOnlyThoseStartingBeforeTheEndAreNamed() {
        // given
        facility.createAccessPoint("Court gate", courts.subList(0, 1), null);
        facility.createAccessPoint("Clubhouse door", courts.subList(1, 2), "246810");
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID inRange = book(courts.get(0));
        book(courts.get(1));

        // when
        var before = announcer.accessDemandsStartingBefore(EVENING.start(), Instant.parse("2026-05-12T10:00:00Z"),
                new UUID(0, 0), 10);
        var through = announcer.accessDemandsStartingBefore(EVENING.end(), Instant.parse("2026-05-12T10:00:00Z"),
                new UUID(0, 0), 10);

        // then
        assertThat(before).as("a booking starting at the end of the range lies outside it").isEmpty();
        assertThat(through).as("the court behind a static code only is left out")
                .extracting(AccessDemand::bookingId).containsExactly(inRange);
    }

    @Test
    void givenABookingThatEndedWithinItsLag_whenPagingDemands_thenItIsStillNamedUntilItsWindowEnds() {
        // given
        facility.createAccessPoint("Court gate", courts, null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID booking = book(courts.get(0));

        // when
        var withinTheLag = announcer.accessDemandsStartingBefore(EVENING.end(), EVENING.end().plusSeconds(600),
                new UUID(0, 0), 10);
        var afterTheWindow = announcer.accessDemandsStartingBefore(EVENING.end(), EVENING.end().plusSeconds(900),
                new UUID(0, 0), 10);

        // then
        assertThat(withinTheLag).as("a door still opens fifteen minutes after the end")
                .extracting(AccessDemand::bookingId).containsExactly(booking);
        assertThat(afterTheWindow).isEmpty();
    }

    @Test
    void givenMoreBookingsThanAPage_whenPagingDemands_thenEachPageContinuesAfterTheLastId() {
        // given
        facility.createAccessPoint("Court gate", courts, null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID first = book(courts.get(0));
        UUID second = book(courts.get(1));
        List<UUID> ordered = first.toString().compareTo(second.toString()) < 0 ? List.of(first, second)
                : List.of(second, first);

        // when
        var page = announcer.accessDemandsStartingBefore(EVENING.end(), EVENING.start(), new UUID(0, 0), 1);
        var next = announcer.accessDemandsStartingBefore(EVENING.end(), EVENING.start(), ordered.get(0), 1);

        // then
        assertThat(page).extracting(AccessDemand::bookingId).containsExactly(ordered.get(0));
        assertThat(next).extracting(AccessDemand::bookingId).containsExactly(ordered.get(1));
    }

    private UUID book(UUID court) {
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        return bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD, EVENING, janeAccount, jane,
                Set.of(Role.MEMBER), null, john);
    }
}
