package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({BookingTestFixture.class, CardTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class})
class SessionAppointmentAccessTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private UserDetailsService userDetailsService;

    private MockMvc mockMvc;
    private UUID administratorPerson;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        administratorPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(administratorPerson, "doe.jane", Set.of(Role.ADMIN));
        UUID treasurer = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(treasurer, "roe.john", Set.of(Role.MEMBER, Role.TREASURER));
        identity.signInAs("doe.jane");
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenNoActiveCardNamingTheTreasurer_whenItReadsTheSession_thenItNeitherManagesNorCreatesSeries()
            throws Exception {
        // when / then
        session("roe.john")
                .andExpect(jsonPath("$.managesAppointments").value(false))
                .andExpect(jsonPath("$.createsSeries").value(false));
    }

    @Test
    void givenACardNamingTheTreasurerOnlyAsManagingRole_whenItReadsTheSession_thenItManagesButCreatesNoSeries()
            throws Exception {
        // given
        cards.createBookingCard("Club evening", Set.of(Role.TRAINER), Set.of(Role.TREASURER));

        // when / then
        session("roe.john")
                .andExpect(jsonPath("$.managesAppointments").value(true))
                .andExpect(jsonPath("$.createsSeries").value(false));
    }

    @Test
    void givenACardOpenToEveryRoleThatTracksNoPlayers_whenTheTreasurerReadsTheSession_thenItCreatesSeries()
            throws Exception {
        // given
        cards.createBookingCard("Open practice", Set.of(), Set.of());

        // when / then
        session("roe.john")
                .andExpect(jsonPath("$.managesAppointments").value(false))
                .andExpect(jsonPath("$.createsSeries").value(true));
    }

    @Test
    void givenACardForTheTreasurerThatTracksPlayers_whenItReadsTheSession_thenItCreatesNoSeries()
            throws Exception {
        // given
        cards.createBookingCard("Treasurer doubles", Set.of(Role.TREASURER), Set.of(), (short) 4);

        // when / then
        session("roe.john")
                .andExpect(jsonPath("$.createsSeries").value(false));
    }

    @Test
    void givenADeactivatedCardForTheTreasurer_whenItReadsTheSession_thenTheCardGrantsNothing()
            throws Exception {
        // given
        UUID retired = cards.createBookingCard("Retired evening", Set.of(Role.TREASURER), Set.of(Role.TREASURER));
        cards.deactivateBookingCard(retired);

        // when / then
        session("roe.john")
                .andExpect(jsonPath("$.managesAppointments").value(false))
                .andExpect(jsonPath("$.createsSeries").value(false));
    }

    @Test
    void givenABookedCardNamingMemberAsManagingRole_whenAMemberReadsTheSession_thenTheFlagMatchesTheEmptyManagedList()
            throws Exception {
        // given
        UUID member = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(member, "major.mary", Set.of(Role.MEMBER));
        UUID courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID cardId = cards.createDoublesCardForGuests("Member evening", Set.of(Role.MEMBER));
        bookings.createBookingWithGuest(courtId, cardId,
                new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z")),
                administratorPerson, Set.of(Role.ADMIN), "Richard Miles");

        // when / then
        mockMvc.perform(get("/api/managed/bookings")
                        .with(user(userDetailsService.loadUserByUsername("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
        session("major.mary")
                .andExpect(jsonPath("$.managesAppointments").value(false));
    }

    @Test
    void givenAnAdministrator_whenItReadsTheSession_thenItManagesAndCreatesSeries() throws Exception {
        // when / then
        session("doe.jane")
                .andExpect(jsonPath("$.managesAppointments").value(true))
                .andExpect(jsonPath("$.createsSeries").value(true));
    }

    @Test
    void givenAnAnonymousCaller_whenItReadsTheSession_thenItNeitherManagesNorCreatesSeries() throws Exception {
        // when / then
        mockMvc.perform(get("/api/session").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.managesAppointments").value(false))
                .andExpect(jsonPath("$.createsSeries").value(false));
    }

    private ResultActions session(String username) throws Exception {
        return mockMvc.perform(get("/api/session").with(user(userDetailsService.loadUserByUsername(username))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }
}
