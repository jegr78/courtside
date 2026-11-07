package org.courtside.member;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.AccountAnonymisation;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, FacilityTestFixture.class, BookingTestFixture.class, CardTestFixture.class,
        ConfigTestFixture.class})
class ExternalPersonBecomesMemberTest extends AbstractIntegrationTest {

    private static final String ACTIVE = "cccccccc-0000-0000-0000-000000000001";
    private static final Instant TOMORROW = Instant.parse("2026-05-13T16:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsService userDetails;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private AccountAnonymisation anonymisation;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID court;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void anExternalPlayerWithAPastBooking() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        config.admitExternalBookings(true);
        UUID winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(Instant.parse("2026-05-12T08:00:00Z"), Instant.parse("2026-05-12T09:00:00Z")),
                johnAccount);
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createAccount(richard, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAnExternalPlayer_whenTheBoardAddsAMembershipPeriod_thenTheSameAccountSignsInAsAMemberAndBooksMemberCards()
            throws Exception {
        // given
        UUID membersOnly = cards.createBookingCard("Members", Set.of(), Set.of());
        UUID clubEvening = cards.createBookingCard("Club evening", Set.of(Role.MEMBER), Set.of());

        // when
        asBoard(post("/api/admin/roster/{id}/membership-periods", john)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2026-05-01\",\"endedOn\":null}"))
                .andExpect(status().isCreated());

        // then
        UserDetails signedIn = userDetails.loadUserByUsername("roe.john");
        assertThat(roles(johnAccount)).as("the account gains the member role and keeps the external one")
                .containsExactlyInAnyOrder("MEMBER", "EXTERNAL");
        assertThat(JsonPath.<Boolean>read(mockMvc.perform(get("/api/session").with(user(signedIn)))
                .andReturn().getResponse().getContentAsString(), "$.memberFeatures"))
                .as("the same credentials open the member features").isTrue();
        assertThat(book(membersOnly, signedIn)).as("a card for members only").isNotNull();
        assertThat(book(clubEvening, signedIn)).as("a card naming the member role").isNotNull();
        assertThat(jdbc.sql("SELECT count(*) FROM booking WHERE booked_by = :id").param("id", johnAccount)
                .query(Long.class).single()).as("the earlier booking stays with the account").isEqualTo(3);
        assertThat(rolesChangedEvents()).as("the audit records the role the link added")
                .singleElement().asString().contains(johnAccount.toString()).contains("MEMBER");
        asBoard(post("/api/admin/roster-search").contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"roe\"}"))
                .andExpect(jsonPath("$.matching").value(1));
    }

    @Test
    void givenAnExternalPlayer_whenTheBoardAssignsAMembership_thenTheAccountGainsTheMemberRole() throws Exception {
        // when
        asBoard(put("/api/admin/roster/{id}/membership", john).contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\"}"))
                .andExpect(status().isOk());

        // then
        assertThat(roles(johnAccount)).containsExactlyInAnyOrder("MEMBER", "EXTERNAL");
    }

    @Test
    void givenAPersonWithoutTheExternalRole_whenTheBoardAddsAPeriod_thenTheirRolesStayAsTheBoardSetThem()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID maryAccount = identity.createEnabledAccount(mary, "major.mary", Set.of(Role.TRAINER));

        // when
        asBoard(post("/api/admin/roster/{id}/membership-periods", mary)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2026-05-01\",\"endedOn\":null}"))
                .andExpect(status().isCreated());

        // then
        assertThat(roles(maryAccount)).as("only an external account is linked").containsExactly("TRAINER");
        assertThat(rolesChangedEvents()).isEmpty();
    }

    @Test
    void givenAnExternalPlayer_whenTheBoardRecordsAPeriodThatHasEnded_thenTheAccountStaysExternal() throws Exception {
        // when
        asBoard(post("/api/admin/roster/{id}/membership-periods", john)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2020-01-01\","
                        + "\"endedOn\":\"2021-01-01\"}"))
                .andExpect(status().isCreated());

        // then
        assertThat(roles(johnAccount)).as("a past membership is history, not a link").containsExactly("EXTERNAL");
    }

    @Test
    void givenAClosedAccount_whenTheBoardAddsOrAssignsAMembership_thenTheAnonymisedPersonIsRefused()
            throws Exception {
        // given
        anonymisation.anonymise(johnAccount);

        // when / then
        asBoard(post("/api/admin/roster/{id}/membership-periods", john)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2026-05-01\",\"endedOn\":null}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-anonymised"));
        asBoard(put("/api/admin/roster/{id}/membership", john).contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-anonymised"));
        assertThat(jdbc.sql("SELECT count(*) FROM member WHERE person_id = :id").param("id", john)
                .query(Long.class).single()).as("a closed person holds no membership").isZero();
    }

    @Test
    void givenAPersonWithAnEmailAddress_whenTheBoardSearchesForIt_thenTheRosterFindsThem() throws Exception {
        // when / then
        asBoard(post("/api/admin/roster-search").contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"John.Roe@Example.org\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matching").value(1))
                .andExpect(jsonPath("$.entries[0].personId").value(john.toString()));
    }

    private ResultActions asBoard(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        return mockMvc.perform(request.with(user(userDetails.loadUserByUsername("admin"))).with(csrf())
                .sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()));
    }

    private UUID book(UUID cardId, UserDetails signedIn) {
        Set<Role> roles = signedIn.getAuthorities().stream().map(GrantedAuthority::getAuthority)
                .filter(authority -> authority.startsWith("ROLE_"))
                .map(authority -> Role.valueOf(authority.substring("ROLE_".length())))
                .collect(Collectors.toSet());
        long offset = jdbc.sql("SELECT count(*) FROM booking").query(Long.class).single() * 3600;
        return bookingService.create(new CreateBookingCommand(List.of(court), cardId,
                new TimeSlot(TOMORROW.plusSeconds(offset), TOMORROW.plusSeconds(offset + 3600)), johnAccount, john,
                roles, null, List.of(), null));
    }

    private List<String> roles(UUID accountId) {
        return jdbc.sql("SELECT role FROM user_account_role WHERE user_account_id = :id ORDER BY role")
                .param("id", accountId).query(String.class).list();
    }

    private List<String> rolesChangedEvents() {
        return jdbc.sql("SELECT payload::text FROM domain_event WHERE event_type = 'roster.account.rolesChanged'")
                .query(String.class).list();
    }
}
