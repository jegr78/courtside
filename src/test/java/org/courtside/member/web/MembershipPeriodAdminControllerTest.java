package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class MembershipPeriodAdminControllerTest extends AbstractIntegrationTest {

    private static final String ACTIVE = "cccccccc-0000-0000-0000-000000000001";
    private static final String YOUTH = "cccccccc-0000-0000-0000-000000000002";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID mary;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at",
                        clock.instant().toEpochMilli()))
                .apply(springSecurity())
                .build();
        mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPastAndAScheduledPeriod_whenListingThem_thenBothAppearOldestFirstWithAnExplicitOpenEnd()
            throws Exception {
        // given
        add(period(YOUTH, "2020-01-01", "2026-01-01")).andExpect(status().isCreated());
        add(period(ACTIVE, "2026-06-01", null))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$", org.hamcrest.Matchers.hasEntry("endedOn", null)));

        // when / then
        mockMvc.perform(get(periods()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].membershipTypeId").value(YOUTH))
                .andExpect(jsonPath("$[0].endedOn").value("2026-01-01"))
                .andExpect(jsonPath("$[1].startedOn").value("2026-06-01"))
                .andExpect(jsonPath("$[1]", org.hamcrest.Matchers.hasEntry("endedOn", null)));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenOnlyAPeriodThatBeginsNextMonth_whenReadingTheRosterEntry_thenThePersonIsNotACurrentMember()
            throws Exception {
        // given
        add(period(ACTIVE, "2026-06-01", null)).andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/admin/roster/" + mary))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipCurrent").value(false))
                .andExpect(jsonPath("$.membershipStartedOn").value("2026-06-01"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriodEndingInDecember_whenReadingTheRosterEntry_thenThePersonIsACurrentMember() throws Exception {
        // given
        add(period(ACTIVE, "2026-01-01", "2026-12-31")).andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/admin/roster/" + mary))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipCurrent").value(true))
                .andExpect(jsonPath("$.membershipEndedOn").value("2026-12-31"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARunningPeriod_whenAddingOneThatOverlapsIt_thenTheConflictNamesTheOverlap() throws Exception {
        // given
        add(period(ACTIVE, "2026-01-01", null)).andExpect(status().isCreated());

        // when / then
        add(period(YOUTH, "2026-06-01", null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-periods-overlap"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipPeriod.overlaps"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriod_whenCorrectingAndThenRemovingIt_thenEachAnswerFollows() throws Exception {
        // given
        String body = add(period(ACTIVE, "2026-01-01", null)).andReturn().getResponse().getContentAsString();
        String periodId = JsonPath.read(body, "$.id");

        // when / then
        mockMvc.perform(put(periods() + "/" + periodId).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(period(YOUTH, "2026-02-01", "2026-09-01")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(periodId))
                .andExpect(jsonPath("$.membershipTypeId").value(YOUTH))
                .andExpect(jsonPath("$.startedOn").value("2026-02-01"))
                .andExpect(jsonPath("$.endedOn").value("2026-09-01"));
        mockMvc.perform(delete(periods() + "/" + periodId).with(csrf()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get(periods()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriodOfAnotherPerson_whenRemovingItThroughThisPerson_thenItIsNotFound() throws Exception {
        // given
        String body = add(period(ACTIVE, "2026-01-01", null)).andReturn().getResponse().getContentAsString();
        String periodId = JsonPath.read(body, "$.id");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");

        // when / then
        mockMvc.perform(delete("/api/admin/roster/" + john + "/membership-periods/" + periodId).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-period-not-found"));
        mockMvc.perform(get(periods())).andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriod_whenCorrectingItToEndOnItsFirstDay_thenTheEmptyPeriodIsRefused() throws Exception {
        // given
        String body = add(period(ACTIVE, "2026-01-01", null)).andReturn().getResponse().getContentAsString();
        String periodId = JsonPath.read(body, "$.id");

        // when / then
        mockMvc.perform(put(periods() + "/" + periodId).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(period(ACTIVE, "2026-03-01", "2026-03-01")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:invalid-membership-period"))
                .andExpect(jsonPath("$.detail").value("The membership period is not usable"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipPeriod.coversNoDay"));
        mockMvc.perform(get(periods()))
                .andExpect(jsonPath("$[0].startedOn").value("2026-01-01"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenAddingAPeriodWithoutAStart_thenTheFieldIsNamed() throws Exception {
        // when / then
        add("{\"membershipTypeId\":\"" + ACTIVE + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("startedOn"));
    }

    @Test
    @WithMockUser(username = "jane.doe", roles = "MEMBER")
    void givenAMember_whenTheyTouchSomebodysPeriods_thenEveryOperationIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get(periods())).andExpect(status().isForbidden());
        add(period(ACTIVE, "2026-01-01", null)).andExpect(status().isForbidden());
        mockMvc.perform(delete(periods() + "/" + UUID.randomUUID()).with(csrf()))
                .andExpect(status().isForbidden());
    }

    private String periods() {
        return "/api/admin/roster/" + mary + "/membership-periods";
    }

    private org.springframework.test.web.servlet.ResultActions add(String body) throws Exception {
        MockHttpServletRequestBuilder request = post(periods()).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content(body);
        return mockMvc.perform(request);
    }

    private static String period(String typeId, String startedOn, String endedOn) {
        return "{\"membershipTypeId\":\"" + typeId + "\",\"startedOn\":\"" + startedOn + "\",\"endedOn\":"
                + (endedOn == null ? "null" : "\"" + endedOn + "\"") + "}";
    }
}
