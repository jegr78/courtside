package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LoginTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        Person jane = persons.save(new Person("Jane", "Doe", "family@example.org"));
        Person john = persons.save(new Person("John", "Roe", "family@example.org"));

        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.MEMBER))));
        accounts.save(enabled(new UserAccount(
                john, "roe.john", passwordEncoder.encode("battery-staple"), Set.of(Role.MEMBER))));
    }

    @Test
    void givenTwoAccountsSharingOneEmailAddress_whenEachLogsIn_thenBothSucceed() throws Exception {
        // when / then
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/session")
                        .param("username", "roe.john")
                        .param("password", "battery-staple")
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    void givenNoSession_whenReadingTheSession_thenItReportsAnonymous() throws Exception {
        // when / then
        mockMvc.perform(get("/api/session"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.username").doesNotExist());
    }

    @Test
    void givenAnAuthenticatedMember_whenReadingTheSession_thenItReportsTheMember() throws Exception {
        // given
        MvcResult login = mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) login.getRequest().getSession(false);

        // when / then
        mockMvc.perform(get("/api/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.username").value("doe.jane"))
                .andExpect(jsonPath("$.displayName").value("Jane Doe"))
                .andExpect(jsonPath("$.locale").value("de"))
                .andExpect(jsonPath("$.roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.passwordChangeRequired").value(false));
    }

    @Test
    void givenAnEnabledAccount_whenLoggingInWithAWrongPassword_thenUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "wrong")
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Not authenticated"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAnAccountAwaitingApproval_whenLoggingIn_thenUnauthorized() throws Exception {
        // given
        Person pending = persons.save(new Person("Mary", "Major", "new@example.org"));
        accounts.save(new UserAccount(
                pending, "major.mary", passwordEncoder.encode("secret"), Set.of(Role.MEMBER)));

        // when / then — the body must be indistinguishable from a wrong password, so it never
        // confirms whether an account exists
        mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", "secret")
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Not authenticated"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenTheBootstrapAdmin_whenChangingTheInitialPassword_thenTheOldPasswordStopsWorking()
            throws Exception {
        // given
        Person admin = persons.save(new Person("Ada", "Admin", "admin@localhost.invalid"));
        UserAccount account = enabled(new UserAccount(admin, "admin",
                passwordEncoder.encode("temporary-password"), Set.of(Role.ADMIN)));
        account.requirePasswordChange();
        accounts.save(account);

        MvcResult login = mockMvc.perform(post("/api/session")
                        .param("username", "admin")
                        .param("password", "temporary-password")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("X-Courtside-Password-Change-Required", "true"))
                .andReturn();
        MockHttpSession session = (MockHttpSession) login.getRequest().getSession(false);

        mockMvc.perform(post("/api/admin/config").session(session).with(csrf()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/public/booking-cards").session(session))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/public/participant-cards").session(session))
                .andExpect(status().isForbidden());

        // when
        mockMvc.perform(put("/api/account/initial-password")
                        .session(session)
                        .with(csrf())
                        .contentType("application/json")
                        .content("{\"password\":\"permanent-password\"}"))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(post("/api/session")
                        .param("username", "admin")
                        .param("password", "temporary-password")
                        .with(csrf()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/session")
                        .param("username", "admin")
                        .param("password", "permanent-password")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().doesNotExist("X-Courtside-Password-Change-Required"));
    }

    private UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }
}
