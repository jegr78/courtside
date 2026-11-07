package org.courtside.dataexchange.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.AccountAnonymisation;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class, FacilityTestFixture.class, BookingTestFixture.class,
        CardTestFixture.class, ConfigTestFixture.class})
class ExternalAccountRetentionTest extends AbstractIntegrationTest {

    private static final Instant LONG_AGO = Instant.parse("2023-03-01T10:00:00Z");
    private static final TimeSlot TOMORROW =
            new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private WebApplicationContext context;

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
    private AccountAnonymisation anonymisation;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID court;
    private UUID winterDoubles;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()))
                .apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        config.admitExternalBookings(true);
        winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        UUID adminPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createAccount(adminPerson, "admin", Set.of(Role.ADMIN));
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenExternalAccountsInactiveSinceBeforeTheCutoff_whenTheRunApplies_thenOnlyThoseAreAnonymised()
            throws Exception {
        // given
        UUID gone = external("John", "Roe");
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(LONG_AGO, LONG_AGO.plusSeconds(3600)), gone);
        UUID signedInLately = external("Mary", "Major");
        identity.recordSignIn(signedInLately, Instant.parse("2026-04-01T10:00:00Z"));
        UUID bookedAhead = external("Jane", "Doe");
        bookings.createBookingWithGuest(court, winterDoubles, TOMORROW, bookedAhead,
                identity.personIdForUsername("doe.jane"), Set.of(Role.EXTERNAL), null, "Mary Major");
        UUID formerMember = external("Ann", "Roe");
        members.addMembershipPeriod(identity.personIdForUsername("roe.ann"), members.createMembershipType("Adult"),
                LocalDate.of(2020, 1, 1), LocalDate.of(2021, 1, 1));
        UUID closed = external("Rick", "Miles");
        anonymisation.anonymise(closed);
        UUID bookedSinceTheCutoff = external("Ann", "Major");
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(Instant.parse("2026-01-10T10:00:00Z"), Instant.parse("2026-01-10T11:00:00Z")),
                bookedSinceTheCutoff);
        UUID idleBesideAnActiveOne = external("Jim", "Roe");
        UUID activeSecondAccount = identity.createEnabledAccount(identity.personIdForUsername("roe.jim"),
                "roe.jim.two", Set.of(Role.EXTERNAL));
        keep("EXTERNAL_ACCOUNTS", 12);

        // when
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.externalAccounts.inactiveBefore").value("2025-05-11T22:00:00Z"))
                .andExpect(jsonPath("$.externalAccounts.accounts").value(1))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", JsonPath.<String>read(preview, "$.previewId"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.externalAccountsAnonymised").value(1))
                .andExpect(jsonPath("$.externalAccountsSkipped").value(0));

        // then
        assertThat(anonymised(gone)).as("inactive since before the cut-off").isTrue();
        assertThat(jdbc.sql("SELECT p.last_name FROM person p JOIN user_account a ON a.person_id = p.id WHERE a.id = :id")
                .param("id", gone).query(String.class).single()).as("the name is gone").isNotEqualTo("Roe");
        assertThat(anonymised(signedInLately)).as("a recent sign-in keeps the account").isFalse();
        assertThat(anonymised(bookedAhead)).as("an upcoming booking keeps the account").isFalse();
        assertThat(anonymised(formerMember)).as("a membership period puts the person under the member categories")
                .isFalse();
        assertThat(anonymised(bookedSinceTheCutoff)).as("a booking that ended after the cut-off keeps the account")
                .isFalse();
        assertThat(anonymised(idleBesideAnActiveOne) || anonymised(activeSecondAccount))
                .as("a person stays while any of their accounts was active").isFalse();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoPeriodForExternalAccounts_whenPreviewed_thenTheCategoryIsLeftOut() throws Exception {
        // given
        external("John", "Roe");
        keep("BOOKINGS", 24);

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.externalAccounts").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPreviewedExternalAccount_whenItSignsInBeforeTheRun_thenTheRunSkipsIt() throws Exception {
        // given
        UUID john = external("John", "Roe");
        keep("EXTERNAL_ACCOUNTS", 12);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(jsonPath("$.externalAccounts.accounts").value(1))
                .andReturn().getResponse().getContentAsString();
        identity.recordSignIn(john, clock.instant());

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", JsonPath.<String>read(preview, "$.previewId"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.externalAccountsAnonymised").value(0))
                .andExpect(jsonPath("$.externalAccountsSkipped").value(1));
        assertThat(anonymised(john)).as("the run checks again before it anonymises").isFalse();
    }

    private UUID external(String firstName, String lastName) {
        UUID person = identity.createPerson(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org");
        UUID account = identity.createEnabledAccount(person, (lastName + "." + firstName).toLowerCase(),
                Set.of(Role.EXTERNAL));
        jdbc.sql("UPDATE user_account SET created_at = :createdAt WHERE id = :id")
                .param("createdAt", java.sql.Timestamp.from(LONG_AGO)).param("id", account).update();
        return account;
    }

    private boolean anonymised(UUID accountId) {
        return jdbc.sql("SELECT anonymised_at IS NOT NULL FROM user_account WHERE id = :id")
                .param("id", accountId).query(Boolean.class).single();
    }

    private void keep(String category, int months) throws Exception {
        mockMvc.perform(put("/api/admin/retention/policies/{category}", category).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"retainMonths\": " + months + "}"))
                .andExpect(status().isOk());
    }
}
