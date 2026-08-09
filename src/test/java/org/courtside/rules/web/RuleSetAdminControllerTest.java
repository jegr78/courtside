package org.courtside.rules.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class RuleSetAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenCreatingARuleSet_thenItIsListedWithItsName() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Guests"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Guests"));
    }

    @Test
    void whenCreatingARuleSet_thenTheLocationHeaderResolvesToTheCreatedRuleSet() throws Exception {
        // given
        MvcResult created = mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Guests"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        String location = created.getResponse().getHeader("Location");
        String id = location.substring(location.lastIndexOf('/') + 1);

        // when / then
        mockMvc.perform(get(location))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.name").value("Guests"))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void givenADeactivatedRuleSet_whenListingRuleSets_thenItIsReportedInactive() throws Exception {
        // given
        String id = createRuleSet("Trial");
        deactivateRuleSet(id);

        // when / then
        mockMvc.perform(get("/api/admin/rule-sets"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '%s')].active".formatted(id)).value(false));
    }

    @Test
    void givenAnUnknownRuleSet_whenGettingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/rule-sets/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-not-found"))
                .andExpect(jsonPath("$.title").value("Rule set not found"));
    }

    @Test
    void givenARuleSet_whenChangingItsName_thenTheNewNameIsReturned() throws Exception {
        // given
        String id = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Probationary"}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Probationary"));
    }

    @Test
    void whenCreatingARuleSet_thenItIsActiveByDefault() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Guests"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void givenARuleSet_whenDeactivatingIt_thenItIsReportedInactive() throws Exception {
        // given
        String id = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void givenADeactivatedRuleSet_whenReactivatingIt_thenItIsReportedActiveAgain() throws Exception {
        // given
        String id = createRuleSet("Trial");
        mockMvc.perform(put("/api/admin/rule-sets/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()));

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": true}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void givenAnUnknownRuleSet_whenDeactivatingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + UUID.randomUUID() + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-not-found"));
    }

    @Test
    void givenARuleSet_whenCreatingASecondWithTheSameName_thenItIsAConflict() throws Exception {
        // given
        createRuleSet("Corporate");

        // when / then
        mockMvc.perform(post("/api/admin/rule-sets")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Corporate"}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:rule-set-name-taken"));
    }

    @Test
    void givenARuleSet_whenChangingItWithoutAName_thenItIsRejectedAsInvalid() throws Exception {
        // given
        String id = createRuleSet("Trial");

        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("name"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    void givenAnUnknownRuleSet_whenChangingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/rule-sets/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Nothing"}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Rule set not found"));
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

    private void deactivateRuleSet(String id) throws Exception {
        mockMvc.perform(put("/api/admin/rule-sets/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());
    }
}
