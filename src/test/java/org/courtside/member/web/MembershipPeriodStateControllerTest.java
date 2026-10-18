package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.util.UUID;

import static org.hamcrest.Matchers.hasEntry;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
@TestPropertySource(properties = "courtside.test.clock=2026-05-11T22:30:00Z")
class MembershipPeriodStateControllerTest extends AbstractIntegrationTest {

    private static final String ACTIVE = "cccccccc-0000-0000-0000-000000000001";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at",
                        clock.instant().toEpochMilli()))
                .apply(springSecurity())
                .build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenHalfPastMidnightInTheClubWhileUtcIsStillOnTheDayBefore_whenListingPeriods_thenEachStateFollowsTheClubsDay()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        add(mary, "2026-05-01", "2026-05-12");
        add(mary, "2026-05-12", "2026-05-13");
        add(mary, "2026-05-13", "2026-06-01");

        // when / then
        mockMvc.perform(get(periods(mary)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].state").value("ENDED"))
                .andExpect(jsonPath("$[1].state").value("RUNNING"))
                .andExpect(jsonPath("$[2].state").value("SCHEDULED"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenHalfPastMidnightInTheClub_whenReadingRosterEntries_thenTheMembershipStateFollowsTheClubsDay()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        add(mary, "2026-05-12", null);
        add(john, "2026-05-13", null);
        add(richard, "2026-01-01", "2026-05-12");

        // when / then
        mockMvc.perform(get("/api/admin/roster/" + mary))
                .andExpect(jsonPath("$.membershipState").value("RUNNING"))
                .andExpect(jsonPath("$.membershipCurrent").value(true));
        mockMvc.perform(get("/api/admin/roster/" + john))
                .andExpect(jsonPath("$.membershipState").value("SCHEDULED"))
                .andExpect(jsonPath("$.membershipCurrent").value(false));
        mockMvc.perform(get("/api/admin/roster/" + richard))
                .andExpect(jsonPath("$.membershipState").value("ENDED"))
                .andExpect(jsonPath("$.membershipCurrent").value(false));
        mockMvc.perform(get("/api/admin/roster/" + jane))
                .andExpect(jsonPath("$", hasEntry("membershipState", null)));
    }

    private void add(UUID personId, String startedOn, String endedOn) throws Exception {
        mockMvc.perform(post(periods(personId)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"membershipTypeId\":\"" + ACTIVE + "\",\"startedOn\":\"" + startedOn
                                + "\",\"endedOn\":" + (endedOn == null ? "null" : "\"" + endedOn + "\"") + "}"))
                .andExpect(status().isCreated());
    }

    private static String periods(UUID personId) {
        return "/api/admin/roster/" + personId + "/membership-periods";
    }
}
