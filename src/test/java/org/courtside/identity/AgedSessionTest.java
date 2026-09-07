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

import java.util.Collections;
import java.util.Set;

import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AgedSessionTest extends AbstractIntegrationTest {

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
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de")));
    }

    @Test
    void givenAnAgedSessionInTheBrowser_whenTheMemberSignsInAgain_thenTheSignInIsNotRefused() throws Exception {
        // given — a session whose creation time is long past the absolute lifetime
        MockHttpSession aged = aged();

        // when / then
        mockMvc.perform(post("/api/session")
                        .session(aged)
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    void givenARealSignedInSessionPastTheLifetime_whenItActs_thenItHasNoAuthorityLeft() throws Exception {
        // given — the session a member actually holds, carrying its security context, aged past the
        // absolute lifetime. A blank session would be anonymous whether or not this filter ran.
        MockHttpSession aged = aged(signedIn());

        // when / then
        mockMvc.perform(get("/api/admin/config").session(aged))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenTheSameSessionInsideTheLifetime_whenItActs_thenItStillHasIt() throws Exception {
        // given — the counter-case: the same account and the same request, only not aged. Without
        // it, a filter that refused everything would look identical.
        MockHttpSession young = signedIn();

        // when / then
        mockMvc.perform(get("/api/admin/config").session(young))
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

    private MockHttpSession aged(MockHttpSession signedIn) {
        MockHttpSession aged = aged();
        Collections.list(signedIn.getAttributeNames())
                .forEach(name -> aged.setAttribute(name, signedIn.getAttribute(name)));
        return aged;
    }

    private MockHttpSession aged() {
        return new MockHttpSession() {
            @Override
            public long getCreationTime() {
                return 0L;
            }
        };
    }
}
