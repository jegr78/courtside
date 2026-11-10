package org.courtside.member;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.AccountAnonymisation;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.time.LocalDate;
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
    private MemberTestFixture members;

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
    private CreditTestFixture credit;

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
    void givenAnExternalPlayerWithAPastPeriod_whenTheBoardCorrectsItToRunOn_thenTheAccountGainsTheMemberRole()
            throws Exception {
        // given
        String added = asBoard(post("/api/admin/roster/{id}/membership-periods", john)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2020-01-01\","
                        + "\"endedOn\":\"2021-01-01\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();

        // when
        asBoard(put("/api/admin/roster/{id}/membership-periods/{periodId}", john, JsonPath.<String>read(added, "$.id"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2020-01-01\",\"endedOn\":null}"))
                .andExpect(status().isOk());

        // then
        assertThat(roles(johnAccount)).as("a correction that leaves a running membership links the account")
                .containsExactlyInAnyOrder("MEMBER", "EXTERNAL");
    }

    @Test
    void givenAClosedAccount_whenTheBoardWritesAMembership_thenTheAnonymisedPersonIsRefused()
            throws Exception {
        // given
        UUID earlier = members.addMembershipPeriod(john, UUID.fromString(ACTIVE), LocalDate.of(2020, 1, 1),
                LocalDate.of(2021, 1, 1));
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
        asBoard(put("/api/admin/roster/{id}/membership-periods/{periodId}", john, earlier)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2020-01-01\",\"endedOn\":null}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:account-anonymised"));
        assertThat(jdbc.sql("SELECT count(*) FROM member WHERE person_id = :id AND ended_on IS NULL").param("id", john)
                .query(Long.class).single()).as("a closed person holds no running membership").isZero();
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

    @Test
    void givenAnOutsiderWithCreditAPaidAndAPendingBooking_whenTheBoardAddsAMembership_thenTheMoneyStaysReachable()
            throws Exception {
        // given
        UUID hall = cards.createBookingCard("Winter hall", Set.of(Role.EXTERNAL, Role.MEMBER), Set.of());
        cards.priceForExternals(hall, 1500);
        credit.credit(johnAccount, 4000);
        UUID paid = bookingService.create(new CreateBookingCommand(List.of(court), hall,
                new TimeSlot(TOMORROW, TOMORROW.plusSeconds(3600)), johnAccount, john, Set.of(Role.EXTERNAL), null,
                List.of(), null));
        UUID pending = bookings.createPendingBooking(court, hall,
                new TimeSlot(TOMORROW.plusSeconds(7200), TOMORROW.plusSeconds(10800)), johnAccount,
                clock.instant().plusSeconds(900));

        // when
        asBoard(post("/api/admin/roster/{id}/membership-periods", john)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"2026-05-01\",\"endedOn\":null}"))
                .andExpect(status().isCreated());

        // then
        asBoard(get("/api/treasury/credit/accounts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.accountId == '" + johnAccount + "')].balanceMinor").value(2500));
        asBoard(post("/api/treasury/credit/accounts/{id}/entries", johnAccount)
                .header("Idempotency-Key", "payout-1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"PAYOUT\",\"amountMinor\":1000,\"note\":\"Paid out in cash\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.balanceAfterMinor").value(1500));
        bookingService.cancel(paid, johnAccount, Set.of(Role.MEMBER, Role.EXTERNAL));
        assertThat(credit.balance(johnAccount)).as("the member's cancellation returns what the outsider paid")
                .isEqualTo(3000);
        assertThat(jdbc.sql("SELECT status FROM booking WHERE id = :id").param("id", pending).query(String.class)
                .single()).as("the booking awaiting PayPal still awaits it").isEqualTo("PENDING_PAYMENT");
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
