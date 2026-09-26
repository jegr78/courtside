package org.courtside.reporting.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class,
        NotificationTestFixture.class})
class StatisticsControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID CLOSURE_CARD = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID BALL_MACHINE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID LOOKING_FOR_A_PARTNER = UUID.fromString("66666666-6666-6666-6666-666666666666");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenBookingsClosuresAndCancellations_whenReadingAWeek_thenOccupancyLeavesClosuresOut() throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID centre = facility.createCourt(1, "Centre");
        UUID clay = facility.createCourt(2, "Clay");
        UUID bothCourts = booking(MEMBER_CARD, "CONFIRMED", null);
        allocate(bothCourts, centre, "2026-05-05T06:00:00Z", "2026-05-05T07:00:00Z", "CONFIRMED");
        allocate(bothCourts, clay, "2026-05-05T06:00:00Z", "2026-05-05T07:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CANCELLED", null), centre,
                "2026-05-06T06:00:00Z", "2026-05-06T08:00:00Z", "CANCELLED");
        allocate(booking(CLOSURE_CARD, "CONFIRMED", null), clay,
                "2026-05-07T06:00:00Z", "2026-05-07T10:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), centre,
                "2026-05-03T21:30:00Z", "2026-05-04T07:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), centre,
                "2026-05-10T09:00:00Z", "2026-05-10T23:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), centre,
                "2026-05-08T18:00:00Z", "2026-05-08T19:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-05-04").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period.from").value("2026-05-04"))
                .andExpect(jsonPath("$.period.to").value("2026-05-10"))
                .andExpect(jsonPath("$.period.timeZone").value("Europe/Berlin"))
                .andExpect(jsonPath("$.totals.openMinutes").value(1680))
                .andExpect(jsonPath("$.totals.courtCount").value(2))
                .andExpect(jsonPath("$.totals.capacityMinutes").value(3360))
                .andExpect(jsonPath("$.totals.closedMinutes").value(240))
                .andExpect(jsonPath("$.totals.bookedMinutes").value(240))
                .andExpect(jsonPath("$.totals.occupancy").value(closeTo(240.0 / 3120, 1e-9), Double.class))
                .andExpect(jsonPath("$.courts[0].courtId").value(centre.toString()))
                .andExpect(jsonPath("$.courts[0].bookings").value(4))
                .andExpect(jsonPath("$.courts[0].bookedMinutes").value(180))
                .andExpect(jsonPath("$.courts[0].closedMinutes").value(0))
                .andExpect(jsonPath("$.courts[0].occupancy").value(closeTo(180.0 / 1680, 1e-9), Double.class))
                .andExpect(jsonPath("$.courts[1].courtId").value(clay.toString()))
                .andExpect(jsonPath("$.courts[1].bookings").value(1))
                .andExpect(jsonPath("$.courts[1].bookedMinutes").value(60))
                .andExpect(jsonPath("$.courts[1].closedMinutes").value(240))
                .andExpect(jsonPath("$.courts[1].occupancy").value(closeTo(60.0 / 1440, 1e-9), Double.class))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + MEMBER_CARD + "')].bookings").value(4))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + MEMBER_CARD + "')].minutes").value(240))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + MEMBER_CARD + "')].closure").value(false))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + CLOSURE_CARD + "')].bookings").value(1))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + CLOSURE_CARD + "')].minutes").value(240))
                .andExpect(jsonPath("$.cards[?(@.cardId == '" + CLOSURE_CARD + "')].closure").value(true))
                .andExpect(jsonPath("$.hours.length()").value(168))
                .andExpect(jsonPath(hour(2, 8) + ".openMinutes").value(60))
                .andExpect(jsonPath(hour(2, 8) + ".bookedMinutes").value(120))
                .andExpect(jsonPath(hour(2, 8) + ".occupancy").value(closeTo(1.0, 1e-9), Double.class))
                .andExpect(jsonPath(hour(4, 9) + ".closedMinutes").value(60))
                .andExpect(jsonPath(hour(4, 9) + ".occupancy").value(closeTo(0.0, 1e-9), Double.class))
                .andExpect(jsonPath(hour(1, 8) + ".bookedMinutes").value(60))
                .andExpect(jsonPath(hour(7, 11) + ".bookedMinutes").value(60))
                .andExpect(jsonPath(hour(5, 20) + ".bookedMinutes").value(0))
                .andExpect(jsonPath(hour(1, 0) + ".occupancy").value(nullValue()))
                .andExpect(jsonPath("$.progression.granularity").value("WEEK"))
                .andExpect(jsonPath("$.progression.buckets.length()").value(1))
                .andExpect(jsonPath("$.progression.buckets[0].totals.bookedMinutes").value(240))
                .andExpect(jsonPath("$.previous.period.from").value("2026-04-27"))
                .andExpect(jsonPath("$.previous.period.to").value("2026-05-03"))
                .andExpect(jsonPath("$.previous.totals.openMinutes").value(1680))
                .andExpect(jsonPath("$.previous.totals.bookedMinutes").value(0))
                .andExpect(jsonPath("$.previous.totals.occupancy").value(closeTo(0.0, 1e-9), Double.class));
    }

    @Test
    void givenACourtDeactivatedAfterItWasBooked_whenReadingItsPeriod_thenItCountsAsCapacityOnlyWhereItWasHeld()
            throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID centre = facility.createCourt(1, "Centre");
        UUID retired = facility.createCourt(2, "Clay");
        facility.createInactiveCourt(3, "Grass");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), centre,
                "2026-05-05T06:00:00Z", "2026-05-05T10:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), retired,
                "2026-05-05T06:00:00Z", "2026-05-05T10:00:00Z", "CONFIRMED");
        facility.deactivateCourt(retired);

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-05-05").param("to", "2026-05-05"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.courtCount").value(2))
                .andExpect(jsonPath("$.totals.capacityMinutes").value(480))
                .andExpect(jsonPath("$.totals.bookedMinutes").value(480))
                .andExpect(jsonPath("$.totals.occupancy").value(closeTo(1.0, 1e-9), Double.class))
                .andExpect(jsonPath(hour(2, 8) + ".occupancy").value(closeTo(1.0, 1e-9), Double.class));
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-05-05").param("to", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.courtCount").value(2))
                .andExpect(jsonPath("$.totals.occupancy").value(closeTo(480.0 / 3840, 1e-9), Double.class))
                .andExpect(jsonPath("$.progression.buckets[0].totals.courtCount").value(2))
                .andExpect(jsonPath("$.progression.buckets[0].totals.capacityMinutes").value(2880))
                .andExpect(jsonPath("$.progression.buckets[1].totals.courtCount").value(1))
                .andExpect(jsonPath("$.progression.buckets[1].totals.capacityMinutes").value(480))
                .andExpect(jsonPath("$.previous.totals.courtCount").value(1));
    }

    @Test
    void givenACourtHeldThroughTheAutumnChange_whenReadingThatDay_thenTheRepeatedHourCountsTwice() throws Exception {
        // given
        openEveryDay(LocalTime.of(1, 0), LocalTime.of(5, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-10-24T23:00:00Z", "2026-10-25T04:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-10-25").param("to", "2026-10-25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.openMinutes").value(300))
                .andExpect(jsonPath("$.totals.bookedMinutes").value(300))
                .andExpect(jsonPath("$.totals.occupancy").value(closeTo(1.0, 1e-9), Double.class))
                .andExpect(jsonPath(hour(7, 2) + ".openMinutes").value(120))
                .andExpect(jsonPath(hour(7, 2) + ".bookedMinutes").value(120));
    }

    @Test
    void givenAWindowOpeningInTheRepeatedHour_whenReadingThatDay_thenOpenAndBookedTimeAgree() throws Exception {
        // given
        openEveryDay(LocalTime.of(2, 30), LocalTime.of(5, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-10-24T23:00:00Z", "2026-10-25T05:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-10-25").param("to", "2026-10-25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.openMinutes").value(150))
                .andExpect(jsonPath("$.totals.bookedMinutes").value(150))
                .andExpect(jsonPath("$.totals.occupancy").value(closeTo(1.0, 1e-9), Double.class));
    }

    @Test
    void givenACourtHeldThroughTheSpringChange_whenReadingThatDay_thenTheMissingHourIsNotOpen() throws Exception {
        // given
        openEveryDay(LocalTime.of(1, 0), LocalTime.of(5, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-03-29T00:00:00Z", "2026-03-29T03:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-03-29").param("to", "2026-03-29"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.openMinutes").value(180))
                .andExpect(jsonPath("$.totals.bookedMinutes").value(180))
                .andExpect(jsonPath(hour(7, 2) + ".openMinutes").value(0))
                .andExpect(jsonPath(hour(7, 3) + ".bookedMinutes").value(60));
    }

    @Test
    void givenTwoWeeksAndABit_whenReadingThem_thenTheProgressionFollowsIsoWeeksCutAtTheEnds() throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-05-12T06:00:00Z", "2026-05-12T08:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-05-06").param("to", "2026-05-19"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progression.granularity").value("WEEK"))
                .andExpect(jsonPath("$.progression.buckets.length()").value(3))
                .andExpect(jsonPath("$.progression.buckets[0].startsOn").value("2026-05-06"))
                .andExpect(jsonPath("$.progression.buckets[0].endsOn").value("2026-05-10"))
                .andExpect(jsonPath("$.progression.buckets[0].totals.openMinutes").value(1200))
                .andExpect(jsonPath("$.progression.buckets[1].startsOn").value("2026-05-11"))
                .andExpect(jsonPath("$.progression.buckets[1].endsOn").value("2026-05-17"))
                .andExpect(jsonPath("$.progression.buckets[1].totals.bookedMinutes").value(120))
                .andExpect(jsonPath("$.progression.buckets[1].totals.occupancy").value(closeTo(120.0 / 1680, 1e-9), Double.class))
                .andExpect(jsonPath("$.progression.buckets[2].startsOn").value("2026-05-18"))
                .andExpect(jsonPath("$.progression.buckets[2].endsOn").value("2026-05-19"))
                .andExpect(jsonPath("$.progression.buckets[2].totals.bookedMinutes").value(0));
    }

    @Test
    void givenMoreThanNinetyTwoDays_whenReadingThem_thenTheProgressionIsMonthly() throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-02-28T22:30:00Z", "2026-03-01T08:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-01-15").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progression.granularity").value("MONTH"))
                .andExpect(jsonPath("$.progression.buckets.length()").value(5))
                .andExpect(jsonPath("$.progression.buckets[0].startsOn").value("2026-01-15"))
                .andExpect(jsonPath("$.progression.buckets[0].endsOn").value("2026-01-31"))
                .andExpect(jsonPath("$.progression.buckets[1].totals.bookedMinutes").value(0))
                .andExpect(jsonPath("$.progression.buckets[2].startsOn").value("2026-03-01"))
                .andExpect(jsonPath("$.progression.buckets[2].totals.bookedMinutes").value(60))
                .andExpect(jsonPath("$.progression.buckets[4].endsOn").value("2026-05-10"));
    }

    @Test
    void givenTheWholeAcceptedRange_whenReadingUtilisation_thenItAnswersWithoutAPreviousPeriod() throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID court = facility.createCourt(1, "Centre");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), court,
                "2026-05-05T06:00:00Z", "2026-05-05T07:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "0001-01-01").param("to", "9999-12-31"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.bookedMinutes").value(60))
                .andExpect(jsonPath("$.progression.granularity").value("MONTH"))
                .andExpect(jsonPath("$.progression.buckets.length()").value(9999 * 12))
                .andExpect(jsonPath("$.previous").value(nullValue()));
    }

    @Test
    void givenSeriesGuestsCardsAndCancellations_whenReadingBookings_thenEachIsCountedByItsFirstStart() throws Exception {
        // given
        UUID centre = facility.createCourt(1, "Centre");
        UUID clay = facility.createCourt(2, "Clay");
        UUID single = booking(MEMBER_CARD, "CONFIRMED", null);
        allocate(single, centre, "2026-05-05T08:00:00Z", "2026-05-05T09:00:00Z", "CONFIRMED");
        guest(single, 1);
        guest(single, 2);
        UUID fromSeries = booking(MEMBER_CARD, "CONFIRMED", series(centre));
        allocate(fromSeries, centre, "2026-05-06T08:00:00Z", "2026-05-06T09:00:00Z", "CONFIRMED");
        allocate(fromSeries, clay, "2026-05-06T08:00:00Z", "2026-05-06T09:00:00Z", "CONFIRMED");
        UUID cancelled = booking(MEMBER_CARD, "CANCELLED", null);
        allocate(cancelled, centre, "2026-05-07T08:00:00Z", "2026-05-07T09:00:00Z", "CANCELLED");
        guest(cancelled, 1);
        UUID withCard = booking(MEMBER_CARD, "CONFIRMED", null);
        allocate(withCard, clay, "2026-05-08T08:00:00Z", "2026-05-08T09:00:00Z", "CONFIRMED");
        participantCard(withCard, BALL_MACHINE, 1);
        allocate(booking(CLOSURE_CARD, "CONFIRMED", null), centre,
                "2026-05-08T08:00:00Z", "2026-05-08T12:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null), clay,
                "2026-05-03T21:00:00Z", "2026-05-03T23:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/statistics/bookings")
                        .param("from", "2026-05-04").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.figures.confirmed").value(3))
                .andExpect(jsonPath("$.figures.cancelled").value(1))
                .andExpect(jsonPath("$.figures.cancellationRate").value(closeTo(0.25, 1e-9), Double.class))
                .andExpect(jsonPath("$.figures.series").value(1))
                .andExpect(jsonPath("$.figures.single").value(2))
                .andExpect(jsonPath("$.figures.withGuests").value(1))
                .andExpect(jsonPath("$.figures.guestEntries").value(2))
                .andExpect(jsonPath("$.participantCards[?(@.cardId == '" + BALL_MACHINE + "')].uses").value(1))
                .andExpect(jsonPath("$.participantCards[?(@.cardId == '" + LOOKING_FOR_A_PARTNER + "')].uses").value(0))
                .andExpect(jsonPath("$.previous.period.from").value("2026-04-27"))
                .andExpect(jsonPath("$.previous.figures.confirmed").value(1))
                .andExpect(jsonPath("$.previous.figures.cancelled").value(0))
                .andExpect(jsonPath("$.previous.figures.cancellationRate").value(closeTo(0.0, 1e-9), Double.class));
    }

    @Test
    void givenMembersWhoPlayedLeftOrOnlyCancelled_whenReadingLastMonth_thenOnlyRunningPlayersAreActive() throws Exception {
        // given
        UUID court = facility.createCourt(1, "Centre");
        UUID adult = members.createMembershipType("Adult");
        UUID youth = members.createMembershipType("Youth");
        UUID jane = members.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID john = members.addPerson("John", "Roe", "john.roe@example.org");
        UUID mary = members.addPerson("Mary", "Major", "mary.major@example.org");
        UUID richard = members.addPerson("Richard", "Miles", "richard.miles@example.org");
        members.assignMembership(jane, adult, LocalDate.of(2025, 1, 1));
        members.assignMembership(john, adult, LocalDate.of(2026, 4, 5));
        members.assignMembership(mary, youth, LocalDate.of(2025, 6, 1));
        members.assignMembership(richard, youth, LocalDate.of(2025, 1, 1));
        endMembership(mary, LocalDate.of(2026, 4, 20));
        UUID janeAccount = identity.createEnabledAccount(jane, "jane.doe", Set.of(Role.MEMBER));
        identity.createAccountAwaitingCredentials(john, "john.roe", Set.of(Role.MEMBER));
        UUID maryAccount = identity.createEnabledAccount(mary, "mary.major", Set.of(Role.MEMBER));
        UUID richardAccount = identity.createEnabledAccount(richard, "richard.miles", Set.of(Role.MEMBER));
        identity.requirePasswordChange("richard.miles");
        UUID departed = members.addPerson("Richard", "Roe", "richard.roe@example.org");
        UUID departedAccount = identity.createAccount(departed, "richard.roe", Set.of(Role.MEMBER));
        signedIn(departedAccount, "2026-04-28T10:00:00Z");
        signedIn(janeAccount, "2026-04-25T10:00:00Z");
        signedIn(maryAccount, "2026-02-15T10:00:00Z");
        signedIn(richardAccount, "2026-05-05T10:00:00Z");
        UUID janesGame = booking(MEMBER_CARD, "CONFIRMED", null, janeAccount);
        allocate(janesGame, court, "2026-04-10T08:00:00Z", "2026-04-10T09:00:00Z", "CONFIRMED");
        memberParticipant(janesGame, john, 1);
        guestNamed(janesGame, "Richard Miles", 2);
        allocate(booking(MEMBER_CARD, "CONFIRMED", null, maryAccount), court,
                "2026-04-12T08:00:00Z", "2026-04-12T09:00:00Z", "CONFIRMED");
        allocate(booking(MEMBER_CARD, "CANCELLED", null, richardAccount), court,
                "2026-04-14T08:00:00Z", "2026-04-14T09:00:00Z", "CANCELLED");
        allocate(booking(MEMBER_CARD, "CONFIRMED", null, richardAccount), court,
                "2026-03-15T08:00:00Z", "2026-03-15T09:00:00Z", "CONFIRMED");

        // when
        String body = mockMvc.perform(get("/api/admin/statistics/members"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period.from").value("2026-04-01"))
                .andExpect(jsonPath("$.period.to").value("2026-04-30"))
                .andExpect(jsonPath("$.figures.members").value(3))
                .andExpect(jsonPath("$.figures.joins").value(1))
                .andExpect(jsonPath("$.figures.leavings").value(1))
                .andExpect(jsonPath("$.figures.activeMembers").value(2))
                .andExpect(jsonPath("$.figures.activeShare").value(closeTo(2.0 / 3, 1e-9), Double.class))
                .andExpect(jsonPath("$.membershipTypes[?(@.membershipTypeId == '" + adult + "')].members").value(2))
                .andExpect(jsonPath("$.membershipTypes[?(@.membershipTypeId == '" + youth + "')].members").value(1))
                .andExpect(jsonPath("$.previous.period.from").value("2026-03-02"))
                .andExpect(jsonPath("$.previous.period.to").value("2026-03-31"))
                .andExpect(jsonPath("$.previous.figures.members").value(3))
                .andExpect(jsonPath("$.previous.figures.joins").value(0))
                .andExpect(jsonPath("$.previous.figures.activeMembers").value(1))
                .andExpect(jsonPath("$.accounts.accounts").value(4))
                .andExpect(jsonPath("$.accounts.passwordChosen").value(2))
                .andExpect(jsonPath("$.accounts.withoutChosenPassword").value(2))
                .andExpect(jsonPath("$.accounts.signedInWithin30Days").value(1))
                .andExpect(jsonPath("$.accounts.signedInWithin90Days").value(2))
                .andExpect(jsonPath("$.accounts.neverSignedIn").value(1))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).as("an aggregate names nobody")
                .doesNotContain("Jane", "Doe", "John", "Roe", "Mary", "Major", "Richard", "Miles",
                        "@example.org", jane.toString(), john.toString(), janeAccount.toString());
    }

    @Test
    void givenMessagesAroundThePeriod_whenReadingMessages_thenEachKindCountsItsStatesInside() throws Exception {
        // given
        UUID person = members.addPerson("Jane", "Doe", "jane.doe@example.org");
        UUID account = identity.createEnabledAccount(person, "jane.doe", Set.of(Role.MEMBER));
        notifications.recordHandedOver(account, MessageKind.BOOKING_CONFIRMED, "m1", Instant.parse("2026-05-05T10:00:00Z"));
        notifications.recordRefused(account, MessageKind.BOOKING_CONFIRMED, "m2", Instant.parse("2026-05-06T10:00:00Z"),
                "mailbox unavailable", "550");
        notifications.recordHandedOver(account, MessageKind.CREDENTIALS_NEW_ACCOUNT, "m3",
                Instant.parse("2026-05-10T21:30:00Z"));
        notifications.recordHandedOver(account, MessageKind.BOOKING_REMINDER, "m4", Instant.parse("2026-05-10T22:30:00Z"));
        notifications.recordHandedOver(account, MessageKind.BOOKING_REMINDER, "m5", Instant.parse("2026-05-01T10:00:00Z"));
        message(account, MessageKind.BOOKING_DISPLACED, "FAILED", "2026-05-07T10:00:00Z");
        message(account, MessageKind.BOOKING_DISPLACED, "QUEUED", "2026-05-07T11:00:00Z");

        // when
        String body = mockMvc.perform(get("/api/admin/statistics/messages")
                        .param("from", "2026-05-04").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kinds.length()").value(MessageKind.values().length))
                .andExpect(jsonPath(kind(MessageKind.BOOKING_CONFIRMED) + ".handedOver").value(1))
                .andExpect(jsonPath(kind(MessageKind.BOOKING_CONFIRMED) + ".refused").value(1))
                .andExpect(jsonPath(kind(MessageKind.CREDENTIALS_NEW_ACCOUNT) + ".handedOver").value(1))
                .andExpect(jsonPath(kind(MessageKind.BOOKING_REMINDER) + ".handedOver").value(0))
                .andExpect(jsonPath(kind(MessageKind.BOOKING_DISPLACED) + ".failed").value(1))
                .andExpect(jsonPath(kind(MessageKind.BOOKING_DISPLACED) + ".queued").value(1))
                .andExpect(jsonPath("$.previous.period.to").value("2026-05-03"))
                .andExpect(jsonPath("$.previous" + kind(MessageKind.BOOKING_REMINDER).substring(1) + ".handedOver").value(1))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).as("an aggregate names nobody").doesNotContain("Jane", "Doe", "@example.org", account.toString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"utilisation", "bookings", "members", "messages"})
    void givenOnlyAStartDate_whenReadingASection_thenThePeriodIsRefusedAsIncomplete(String section) throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/statistics/" + section).param("from", "2026-05-01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:statistics-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("reporting.statistics.periodIncomplete"));
    }

    @Test
    void givenAnEndBeforeTheStart_whenReadingUtilisation_thenThePeriodOrderIsRefused() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/statistics/utilisation")
                        .param("from", "2026-05-10").param("to", "2026-05-09"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:statistics-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("reporting.statistics.periodOrder"));
    }

    @Test
    void givenTheYearZero_whenReadingMembers_thenTheDateIsRefusedAsOutOfRange() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/statistics/members")
                        .param("from", "0000-12-31").param("to", "0001-01-10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:statistics-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("reporting.statistics.dateOutOfRange"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMember_whenReadingStatistics_thenAccessIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/statistics/members"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    private static String hour(int isoWeekday, int hour) {
        return "$.hours[" + ((isoWeekday - 1) * 24 + hour) + "]";
    }

    private static String kind(MessageKind kind) {
        return "$.kinds[" + kind.ordinal() + "]";
    }

    private void openEveryDay(LocalTime opensAt, LocalTime closesAt) {
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(opensAt, closesAt));
        }
    }

    private UUID booking(UUID cardId, String status, UUID seriesId) {
        return booking(cardId, status, seriesId, null);
    }

    private UUID booking(UUID cardId, String status, UUID seriesId, UUID bookedBy) {
        UUID bookingId = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status, series_id, booked_by) VALUES (?, ?, ?, ?, ?)")
                .params(bookingId, cardId, status, seriesId, bookedBy)
                .update();
        return bookingId;
    }

    private void allocate(UUID bookingId, UUID courtId, String startsAt, String endsAt, String status) {
        jdbc.sql("""
                        INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), bookingId, courtId,
                        Instant.parse(startsAt).atOffset(ZoneOffset.UTC),
                        Instant.parse(endsAt).atOffset(ZoneOffset.UTC), status)
                .update();
    }

    private UUID series(UUID courtId) {
        UUID seriesId = UUID.randomUUID();
        jdbc.sql("""
                        WITH created AS (
                            INSERT INTO booking_series (id, card_id, starts_on, start_time, duration_minutes,
                                                        interval_weeks, weekdays, occurrence_count)
                            VALUES (?, ?, DATE '2026-05-06', TIME '10:00', 60, 1, '{3}', 4)
                            RETURNING id
                        )
                        INSERT INTO booking_series_court (booking_series_id, court_id, position)
                        SELECT id, ?, 0 FROM created
                        """)
                .params(seriesId, MEMBER_CARD, courtId)
                .update();
        return seriesId;
    }

    private void guest(UUID bookingId, int position) {
        guestNamed(bookingId, "Guest " + position, position);
    }

    private void guestNamed(UUID bookingId, String name, int position) {
        jdbc.sql("INSERT INTO booking_participant (id, booking_id, kind, guest_name, position) VALUES (?, ?, 'GUEST', ?, ?)")
                .params(UUID.randomUUID(), bookingId, name, position)
                .update();
    }

    private void memberParticipant(UUID bookingId, UUID personId, int position) {
        jdbc.sql("INSERT INTO booking_participant (id, booking_id, kind, person_id, position) VALUES (?, ?, 'MEMBER', ?, ?)")
                .params(UUID.randomUUID(), bookingId, personId, position)
                .update();
    }

    private void participantCard(UUID bookingId, UUID cardId, int position) {
        jdbc.sql("INSERT INTO booking_participant (id, booking_id, kind, card_id, position) VALUES (?, ?, 'CARD', ?, ?)")
                .params(UUID.randomUUID(), bookingId, cardId, position)
                .update();
    }

    private void endMembership(UUID personId, LocalDate endedOn) {
        jdbc.sql("UPDATE member SET ended_on = ? WHERE person_id = ?").params(endedOn, personId).update();
    }

    private void signedIn(UUID accountId, String at) {
        jdbc.sql("UPDATE user_account SET last_login_at = ? WHERE id = ?")
                .params(Instant.parse(at).atOffset(ZoneOffset.UTC), accountId)
                .update();
    }

    private void message(UUID accountId, MessageKind kind, String state, String queuedAt) {
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at, settled_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), accountId, kind.name(), state, UUID.randomUUID().toString(),
                        Instant.parse(queuedAt).atOffset(ZoneOffset.UTC),
                        "QUEUED".equals(state) ? null : Instant.parse(queuedAt).atOffset(ZoneOffset.UTC))
                .update();
    }
}
