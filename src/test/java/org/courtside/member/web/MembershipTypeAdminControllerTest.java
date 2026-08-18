package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.member.MemberService;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import(IdentityTestFixture.class)
class MembershipTypeAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberRepository members;

    @Autowired
    private MemberService memberService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenCreatingAMembershipType_thenItIsListedWithItsRuleSet() throws Exception {
        // given
        String ruleSetId = createRuleSet("Seniors");

        // when / then
        mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Supporting", "ruleSetId": "%s"}
                                """.formatted(ruleSetId))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Supporting"))
                .andExpect(jsonPath("$.ruleSetId").value(ruleSetId))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void whenCreatingAMembershipType_thenTheLocationHeaderResolvesToTheCreatedType() throws Exception {
        // given
        String ruleSetId = createRuleSet("Seniors");
        MvcResult created = mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Supporting", "ruleSetId": "%s"}
                                """.formatted(ruleSetId))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        String location = created.getResponse().getHeader("Location");
        String id = location.substring(location.lastIndexOf('/') + 1);

        // when / then
        mockMvc.perform(get(location))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.name").value("Supporting"))
                .andExpect(jsonPath("$.ruleSetId").value(ruleSetId));
    }

    @Test
    void givenAnUnknownMembershipType_whenGettingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/membership-types/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-type-not-found"))
                .andExpect(jsonPath("$.title").value("Membership type not found"));
    }

    @Test
    void whenCreatingAMembershipTypeWithNoRuleSet_thenItReportsANullRuleSetId() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Honorary"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Honorary"))
                .andExpect(jsonPath("$.ruleSetId").doesNotExist());
    }

    @Test
    void givenAnUnknownRuleSet_whenCreatingAMembershipType_thenItIsRejected() throws Exception {
        // given
        UUID ruleSetId = UUID.randomUUID();

        // when / then
        mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Ghost", "ruleSetId": "%s"}
                                """.formatted(ruleSetId))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-unresolvable"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipType.ruleSet.unresolvable"))
                .andExpect(jsonPath("$.violations[0].params.field").value("ruleSetId"))
                .andExpect(jsonPath("$.detail").value(Matchers.not(Matchers.containsString(ruleSetId.toString()))));
    }

    @Test
    void givenAMembershipType_whenCreatingASecondWithTheSameName_thenItIsAConflict() throws Exception {
        // given
        createMembershipType("Family", null);

        // when / then
        mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Family"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:membership-type-name-taken"));
    }

    @Test
    void givenAnUnknownMembershipType_whenChangingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/membership-types/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Nothing"}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Membership type not found"));
    }

    @Test
    void givenADeactivatedRuleSet_whenCreatingAMembershipTypeWithIt_thenItIsRejected() throws Exception {
        // given
        String ruleSetId = createRuleSet("Seniors");
        deactivateRuleSet(ruleSetId);

        // when / then
        mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Supporting", "ruleSetId": "%s"}
                                """.formatted(ruleSetId))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-inactive"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipType.ruleSet.inactive"))
                .andExpect(jsonPath("$.violations[0].params.field").value("ruleSetId"));
    }

    @Test
    void givenADeactivatedRuleSet_whenChangingAMembershipTypeToUseIt_thenItIsRejected() throws Exception {
        // given
        String typeId = createMembershipType("Supporting", null);
        String ruleSetId = createRuleSet("Seniors");
        deactivateRuleSet(ruleSetId);

        // when / then
        mockMvc.perform(put("/api/admin/membership-types/" + typeId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Supporting", "ruleSetId": "%s"}
                                """.formatted(ruleSetId))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-inactive"))
                .andExpect(jsonPath("$.violations[0].code").value("membershipType.ruleSet.inactive"))
                .andExpect(jsonPath("$.violations[0].params.field").value("ruleSetId"));
    }

    @Test
    void givenAMemberOfAType_whenDeactivatingTheType_thenTheMemberStillResolvesToIt() throws Exception {
        // given
        String typeId = createMembershipType("Veterans", null);
        UUID personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        members.save(memberSince(personId, UUID.fromString(typeId)));

        // when
        mockMvc.perform(put("/api/admin/membership-types/" + typeId + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        // then
        assertThat(memberService.membershipTypeIdOf(personId))
                .contains(UUID.fromString(typeId));
    }

    private String createRuleSet(String name) throws Exception {
        String body = mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "%s"}
                                """.formatted(name))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    private void deactivateRuleSet(String ruleSetId) throws Exception {
        mockMvc.perform(put("/api/admin/rule-sets/" + ruleSetId + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private String createMembershipType(String name, String ruleSetId) throws Exception {
        String body = mockMvc.perform(post("/api/admin/membership-types")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ruleSetId == null
                                ? """
                                {"name": "%s"}
                                """.formatted(name)
                                : """
                                {"name": "%s", "ruleSetId": "%s"}
                                """.formatted(name, ruleSetId))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
