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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, CardTestFixture.class,
        ConfigTestFixture.class})
class ExternalBookingPriceTest extends AbstractIntegrationTest {

    private static final Instant TOMORROW_AFTERNOON = Instant.parse("2026-05-13T16:00:00Z");

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
    private UUID externalPerson;
    private UUID externalAccount;
    private UUID winterHall;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        externalPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        externalAccount = identity.createEnabledAccount(externalPerson, "roe.john", Set.of(Role.EXTERNAL));
        config.admitExternalBookings(true);
        winterHall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
    }

    @Test
    void givenABookingMadeBeforeAPriceChange_whenAnotherIsMadeAfterIt_thenEachKeepsThePriceInForceWhenBooked() {
        // given
        cards.priceForExternals(winterHall, 1500);
        UUID before = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 0, Duration.ofHours(1));

        // when
        cards.priceForExternals(winterHall, 1800);
        UUID after = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 24, Duration.ofHours(1));

        // then
        assertThat(amount(before)).as("the price change leaves the earlier booking alone")
                .containsEntry("amount_minor", 1500).containsEntry("amount_currency", "EUR");
        assertThat(amount(after)).containsEntry("amount_minor", 1800).containsEntry("amount_currency", "EUR");
    }

    @Test
    void givenADurationThatIsNoWholeHour_whenAnExternalAccountBooks_thenTheAmountIsProportionalAndRoundedHalfUp() {
        // given
        cards.priceForExternals(winterHall, 1299);

        // when
        UUID ninety = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 0, Duration.ofMinutes(90));
        UUID half = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 24, Duration.ofMinutes(30));

        // then
        assertThat(amount(ninety)).as("12.99 for 90 minutes is 19.485 and rounds half up to 19.49")
                .containsEntry("amount_minor", 1949);
        assertThat(amount(half)).as("12.99 for 30 minutes is 6.495 and rounds half up to 6.50")
                .containsEntry("amount_minor", 650);
    }

    @Test
    void givenTwoCourts_whenAnExternalAccountBooksBoth_thenEachCourtIsPriced() {
        // given
        cards.priceForExternals(winterHall, 1500);
        UUID secondCourt = facility.createCourt(2, "Court 2");

        // when
        UUID booking = bookingService.create(new CreateBookingCommand(List.of(courtId, secondCourt), winterHall,
                new TimeSlot(TOMORROW_AFTERNOON, TOMORROW_AFTERNOON.plus(Duration.ofHours(1))), externalAccount,
                externalPerson, Set.of(Role.EXTERNAL), null, List.of(), null));

        // then
        assertThat(amount(booking)).as("the price is per court and hour").containsEntry("amount_minor", 3000);
    }

    @Test
    void givenACardWithoutAPrice_whenAnExternalAccountBooks_thenTheBookingRecordsThatItCostsNothing() {
        // when
        UUID booking = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 0, Duration.ofHours(1));

        // then
        assertThat(amount(booking)).containsEntry("amount_minor", 0).containsEntry("amount_currency", "EUR");
    }

    @Test
    void givenAPricedCard_whenAMemberOrAnExternalWhoBecameAMemberBooks_thenTheBookingCarriesNoAmount() {
        // given
        cards.priceForExternals(winterHall, 1500);
        UUID memberPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID memberAccount = identity.createEnabledAccount(memberPerson, "doe.jane", Set.of(Role.MEMBER));
        members.holdRunningMembership(memberPerson);
        UUID joinedPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID joinedAccount = identity.createEnabledAccount(joinedPerson, "major.mary",
                Set.of(Role.EXTERNAL, Role.MEMBER));
        members.holdRunningMembership(joinedPerson);

        // when
        UUID member = book(memberAccount, memberPerson, Set.of(Role.MEMBER), 0, Duration.ofHours(1));
        UUID joined = book(joinedAccount, joinedPerson, Set.of(Role.EXTERNAL, Role.MEMBER), 2, Duration.ofHours(1));

        // then
        assertThat(amount(member)).as("a member owes nothing for a court")
                .containsEntry("amount_minor", null).containsEntry("amount_currency", null);
        assertThat(amount(joined)).as("a running membership ends the external price")
                .containsEntry("amount_minor", null).containsEntry("amount_currency", null);
    }

    @Test
    void givenTheClubChargingInFrancs_whenAnExternalAccountBooks_thenTheAmountCarriesTheClubCurrency() {
        // given
        config.chargeIn("CHF");
        cards.priceForExternals(winterHall, 2000);

        // when
        UUID booking = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 0, Duration.ofHours(1));

        // then
        assertThat(amount(booking)).containsEntry("amount_minor", 2000).containsEntry("amount_currency", "CHF");
    }

    @Test
    void givenABooking_whenItsAmountContradictsItsCurrency_thenTheDatabaseRefusesIt() {
        // given
        UUID booking = book(externalAccount, externalPerson, Set.of(Role.EXTERNAL), 0, Duration.ofHours(1));

        // when / then
        assertThatThrownBy(() -> jdbc.sql("UPDATE booking SET amount_currency = NULL WHERE id = :id")
                .param("id", booking).update())
                .hasMessageContaining("booking_amount_in_currency");
        assertThatThrownBy(() -> jdbc.sql("UPDATE booking SET amount_minor = -1 WHERE id = :id")
                .param("id", booking).update())
                .hasMessageContaining("booking_amount_in_currency");
    }

    private UUID book(UUID account, UUID person, Set<Role> roles, int hoursAfter, Duration duration) {
        Instant start = TOMORROW_AFTERNOON.plus(Duration.ofHours(hoursAfter));
        return bookingService.create(new CreateBookingCommand(List.of(courtId), winterHall,
                new TimeSlot(start, start.plus(duration)), account, person, roles, null, List.of(), null));
    }

    private Map<String, Object> amount(UUID booking) {
        return new HashMap<>(jdbc.sql("SELECT amount_minor, amount_currency FROM booking WHERE id = :id")
                .param("id", booking).query().singleRow());
    }
}
