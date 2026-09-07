package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class RevokedSessionTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private AccountSessions sessions;

    private MockMvc mockMvc;
    private UserAccount jane;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        jane = accounts.save(enabled(new UserAccount(
                person, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de")));
    }

    @Test
    void givenASessionWhoseAccountWasRevoked_whenItActs_thenItHasNoAuthorityLeft() throws Exception {
        // given
        MockHttpSession revoked = revoked(signedIn());

        // when / then
        mockMvc.perform(get("/api/admin/config").session(revoked))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASessionWhoseAccountWasRevoked_whenItSignsInAgain_thenTheSignInIsNotRefused()
            throws Exception {
        // given — the cookie the browser still holds is the one the sign-in would replace
        MockHttpSession revoked = revoked(signedIn());

        // when / then
        mockMvc.perform(post("/api/session")
                        .session(revoked)
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    void givenASessionWhoseAccountWasRevoked_whenItIsRefused_thenTheAnswerCarriesTheSecurityHeaders()
            throws Exception {
        // given
        MockHttpSession revoked = revoked(signedIn());

        // when / then — every other refusal carries them, and a response written from inside a
        // filter that answers ahead of the header writer would not
        mockMvc.perform(get("/api/admin/config").session(revoked))
                .andExpect(header().exists("Content-Security-Policy"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }

    @Test
    void givenASessionWhoseAccountStands_whenItActs_thenItStillHasItsAuthority() throws Exception {
        // given — the counter-case for all three above
        MockHttpSession standing = signedIn();

        // when / then
        mockMvc.perform(get("/api/admin/config").session(standing))
                .andExpect(status().isOk());
    }

    private MockHttpSession signedIn() throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }

    private MockHttpSession revoked(MockHttpSession session) {
        UserAccount account = accounts.findById(jane.getId()).orElseThrow();
        sessions.revoke(account);
        accounts.save(account);
        return session;
    }
}
