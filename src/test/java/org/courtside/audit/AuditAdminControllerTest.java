package org.courtside.audit;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class AuditAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserDetailsService userDetailsService;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UserDetails member;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        UUID adminPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(adminPersonId, "doe.jane", Set.of(Role.ADMIN));
        administrator = userDetailsService.loadUserByUsername("doe.jane");

        UUID memberPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(memberPersonId, "roe.john", Set.of(Role.MEMBER));
        member = userDetailsService.loadUserByUsername("roe.john");
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenAChangeByAnAdministrator_whenTheLogIsRead_thenTheEntryNamesTheActorAndTheSubject()
            throws Exception {
        // given
        identity.signInAs("doe.jane");
        UUID courtId = facilityFixture.createCourt(7, "Centre Court");
        identity.signOut();

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].eventType").value("facility.court.added"))
                .andExpect(jsonPath("$.entries[0].subjectName").value("Centre Court"))
                .andExpect(jsonPath("$.entries[0].actorUsername").value("doe.jane"))
                .andExpect(jsonPath("$.entries[0].parameters.number").value(7));
    }

    @Test
    void givenAMember_whenTheLogIsRead_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/audit").with(user(member)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenNoAccountSignedIn_whenTheChangeIsRecorded_thenTheLogNamesNoActor() throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(3, "Court 3");

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].actorAccountId").doesNotExist())
                .andExpect(jsonPath("$.entries[0].actorUsername").doesNotExist());
    }

    @Test
    void givenMoreEntriesThanTheLimit_whenAPageIsRead_thenTheCursorContinuesAfterTheLast()
            throws Exception {
        // given
        facilityFixture.createCourt(1, "Court 1");
        facilityFixture.createCourt(2, "Court 2");
        facilityFixture.createCourt(3, "Court 3");

        // when
        String body = mockMvc.perform(get("/api/admin/audit").param("limit", "2")
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(2)))
                .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        // then
        String cursor = JsonPath.read(body, "$.nextCursor");
        String firstIdOfThePreviousPage = JsonPath.read(body, "$.entries[0].id");
        mockMvc.perform(get("/api/admin/audit").param("limit", "2").param("cursor", cursor)
                        .with(user(administrator)))
                .andExpect(jsonPath("$.entries[0].id").value(not(firstIdOfThePreviousPage)));
    }

    // Every court-added event in this test shares one Instant: the fixed test clock never advances.
    @Test
    void givenSeveralEventsSharingATimestamp_whenPagedWithASmallLimit_thenEveryEventAppearsExactlyOnce()
            throws Exception {
        // given
        for (int number = 1; number <= 5; number++) {
            facilityFixture.createCourt(number, "Court " + number);
        }

        // when
        List<String> collected = new ArrayList<>();
        String cursor = null;
        do {
            MockHttpServletRequestBuilder request = get("/api/admin/audit")
                    .param("limit", "2").with(user(administrator));
            if (cursor != null) {
                request = request.param("cursor", cursor);
            }
            String body = mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            collected.addAll(JsonPath.read(body, "$.entries[*].id"));
            cursor = JsonPath.read(body, "$.nextCursor");
        } while (cursor != null);

        // then
        assertThat(collected).hasSize(5);
        assertThat(new HashSet<>(collected)).hasSize(5);
    }
}
