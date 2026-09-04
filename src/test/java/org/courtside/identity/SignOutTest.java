package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SignOutTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String UNAUTHENTICATED = "urn:courtside:error:unauthenticated";

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
    }

    @Test
    void givenASignedInAccount_whenItSignsOut_thenTheSessionIsGone() throws Exception {
        // given
        enabledAccount("Jane", "Doe", "doe.jane");
        MockHttpSession session = signIn("doe.jane");

        // when
        mockMvc.perform(post("/api/session/logout").session(session).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value(UNAUTHENTICATED));
    }

    // Nothing refuses a sign-out that names no session: LogoutFilter answers it before the
    // authorization rule for this path is ever reached.
    @Test
    void givenNoSession_whenSigningOut_thenItSucceedsAllTheSame() throws Exception {
        // when / then
        mockMvc.perform(post("/api/session/logout").with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    void givenARevokedSession_whenItSignsOut_thenTheRefusalNamesUnauthenticated() throws Exception {
        // given
        UserAccount jane = enabledAccount("Jane", "Doe", "doe.jane");
        MockHttpSession session = signIn("doe.jane");
        jane.disable();
        accounts.saveAndFlush(jane);

        // when / then
        mockMvc.perform(post("/api/session/logout").session(session).with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value(UNAUTHENTICATED));
    }

    private UserAccount enabledAccount(String firstName, String lastName, String username) {
        Person person = persons.save(new Person(
                firstName, lastName, lastName.toLowerCase() + "@example.org"));
        UserAccount account = new UserAccount(
                person, username, passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER), "de");
        account.enable();
        return accounts.save(account);
    }

    private MockHttpSession signIn(String username) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", username)
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }
}
