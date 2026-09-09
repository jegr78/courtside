package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AdminRecentAuthenticationTest extends AbstractIntegrationTest {

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder encoder;

    private MockMvc mockMvc;
    private UUID targetPersonId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person admin = persons.save(new Person("Ada", "Admin", "ada@example.org"));
        accounts.save(enabled(new UserAccount(admin, "admin", encoder.encode("admin-password"),
                Set.of(Role.ADMIN), "en")));
        Person target = persons.save(new Person("Jane", "Doe", "jane@example.org"));
        targetPersonId = target.getId();
        accounts.save(enabled(new UserAccount(target, "member", encoder.encode("member-password"),
                Set.of(Role.MEMBER), "en")));
    }

    @Test
    void givenNoRecentProof_whenAnAdminChangesRoles_thenANewFullPasswordProofIsRequired()
            throws Exception {
        // given
        MockHttpSession session = signIn();
        session.removeAttribute(RecentAuthentication.AUTHENTICATED_AT);

        // when / then
        changeRoles(session)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:recent-authentication-required"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("identity.reauthentication.required"));
        MockHttpSession proven = proveAgain(session);

        // when / then
        changeRoles(proven).andExpect(status().isOk())
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.roles[1]").value("TRAINER"));
    }

    @Test
    void givenNoRecentProof_whenAnAdminPerformsSensitiveChanges_thenEveryChangeIsRefused()
            throws Exception {
        // given
        MockHttpSession session = signIn();
        session.removeAttribute(RecentAuthentication.AUTHENTICATED_AT);
        List<MockHttpServletRequestBuilder> sensitiveRequests = List.of(
                put("/api/admin/roster/{personId}", targetPersonId)
                        .content("{\"firstName\":\"Jane\",\"lastName\":\"Doe\","
                                + "\"email\":\"jane@example.org\"}"),
                post("/api/admin/roster/{personId}/account", targetPersonId)
                        .content("{\"username\":\"another\",\"roles\":[\"MEMBER\"]}"),
                put("/api/admin/roster/{personId}/account/roles", targetPersonId)
                        .content("{\"roles\":[\"MEMBER\"]}"),
                put("/api/admin/roster/{personId}/account/username", targetPersonId)
                        .content("{\"username\":\"renamed\"}"),
                post("/api/admin/roster/{personId}/account/credentials", targetPersonId),
                put("/api/admin/roster/{personId}/account/active", targetPersonId)
                        .content("{\"active\":false}"),
                delete("/api/admin/roster/{personId}/account/sessions", targetPersonId),
                delete("/api/admin/sessions"));

        // when / then
        for (MockHttpServletRequestBuilder request : sensitiveRequests) {
            mockMvc.perform(request.session(session).with(csrf()).contentType("application/json"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type")
                            .value("urn:courtside:error:recent-authentication-required"));
        }
    }

    @Test
    void givenSeveralAccounts_whenAllSessionsAreEnded_thenTheCallingAdminAlsoLosesAuthority()
            throws Exception {
        // given
        MockHttpSession member = (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "member").param("password", "member-password").with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        MockHttpSession admin = signIn();

        // when
        mockMvc.perform(delete("/api/admin/sessions").session(admin).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/session").session(admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").session(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenAnotherAccountsSessions_whenAdminProofIsRefreshed_thenOnlyTheTargetEnds() throws Exception {
        // given
        MockHttpSession member = (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "member").param("password", "member-password").with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        MockHttpSession admin = signIn();
        admin.removeAttribute(RecentAuthentication.AUTHENTICATED_AT);

        // when / then
        mockMvc.perform(delete("/api/admin/roster/{personId}/account/sessions", targetPersonId)
                        .session(admin).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:recent-authentication-required"));
        mockMvc.perform(get("/api/session").session(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));

        // when
        MockHttpSession proven = proveAgain(admin);
        mockMvc.perform(delete("/api/admin/roster/{personId}/account/sessions", targetPersonId)
                        .session(proven).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/session").session(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").session(proven)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    private MockHttpSession proveAgain(MockHttpSession session) throws Exception {
        MockHttpSession proven = (MockHttpSession) mockMvc.perform(
                        post("/api/session/reauthentication").session(session).with(csrf())
                                .contentType("application/json")
                                .content("{\"password\":\"admin-password\"}"))
                .andExpect(status().isNoContent())
                .andReturn().getRequest().getSession(false);
        assertThat(proven).as("a successful proof replaces the session, so the caller carries on"
                + " with the one it was handed rather than the one it presented").isNotNull();
        return proven;
    }

    private MockHttpSession signIn() throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "admin").param("password", "admin-password").with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private org.springframework.test.web.servlet.ResultActions changeRoles(MockHttpSession session)
            throws Exception {
        return mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", targetPersonId)
                .session(session).with(csrf()).contentType("application/json")
                .content("{\"roles\":[\"MEMBER\",\"TRAINER\"]}"));
    }
}
