package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, CardTestFixture.class,
        ConfigTestFixture.class})
class GuestFeeTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private BookingService bookingService;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private CardTestFixture cards;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        members.holdRunningMembership(bookerPersonId);
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenAGuestBookedBeforeAFeeChange_whenAnotherGuestIsBookedAfterIt_thenEachKeepsTheFeeInForceWhenBooked() {
        // given
        cards.chargeGuests(MEMBER_BOOKING_CARD, 500);
        UUID before = bookAt("2026-05-13T16:00:00Z", ParticipantSpec.guest("John Roe"));

        // when
        cards.chargeGuests(MEMBER_BOOKING_CARD, 750);
        UUID after = bookAt("2026-05-13T17:00:00Z", ParticipantSpec.guest("Mary Major"));

        // then
        assertThat(guestFee(before)).as("the fee change leaves the earlier guest alone")
                .containsEntry("guest_fee_minor", 500).containsEntry("guest_fee_currency", "EUR");
        assertThat(guestFee(after)).containsEntry("guest_fee_minor", 750).containsEntry("guest_fee_currency", "EUR");
    }

    @Test
    void givenACardWithoutAFee_whenAGuestIsBooked_thenTheGuestCostsNothingAndTheMemberCarriesNoFee() {
        // when
        UUID booking = bookAt("2026-05-13T16:00:00Z", ParticipantSpec.guest("John Roe"));

        // then
        assertThat(guestFee(booking)).containsEntry("guest_fee_minor", 0);
        assertThat(jdbc.sql("""
                        SELECT count(*) FROM booking_participant
                        WHERE booking_id = :id AND kind = 'MEMBER' AND guest_fee_minor IS NULL AND guest_fee_currency IS NULL
                        """).param("id", booking).query(Integer.class).single())
                .as("a member is no guest and owes nothing").isEqualTo(1);
    }

    @Test
    void givenTheClubChargingInFrancs_whenAGuestIsBooked_thenTheGuestCarriesTheClubCurrency() {
        // given
        config.chargeIn("CHF");
        cards.chargeGuests(MEMBER_BOOKING_CARD, 1000);

        // when
        UUID booking = bookAt("2026-05-13T16:00:00Z", ParticipantSpec.guest("John Roe"));

        // then
        assertThat(guestFee(booking)).containsEntry("guest_fee_minor", 1000).containsEntry("guest_fee_currency", "CHF");
    }

    @Test
    void givenABookedGuestAndMember_whenTheirFeesContradictTheirKind_thenTheDatabaseRefusesBoth() {
        // given
        UUID booking = bookAt("2026-05-13T16:00:00Z", ParticipantSpec.guest("John Roe"));

        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE booking_participant SET guest_fee_minor = NULL WHERE booking_id = :id AND kind = 'GUEST'
                """).param("id", booking).update())
                .as("a guest always carries a fee").hasMessageContaining("booking_participant_guest_fee_matches_kind");
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE booking_participant SET guest_fee_minor = 0, guest_fee_currency = 'EUR'
                WHERE booking_id = :id AND kind = 'MEMBER'
                """).param("id", booking).update())
                .as("a member never carries one").hasMessageContaining("booking_participant_guest_fee_matches_kind");
    }

    private UUID bookAt(String start, ParticipantSpec guest) {
        Instant from = Instant.parse(start);
        return bookingService.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, from.plusSeconds(3600)), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER), null,
                List.of(guest), null));
    }

    private Map<String, Object> guestFee(UUID booking) {
        return jdbc.sql("""
                        SELECT guest_fee_minor, guest_fee_currency FROM booking_participant
                        WHERE booking_id = :id AND kind = 'GUEST'
                        """).param("id", booking).query().singleRow();
    }
}
