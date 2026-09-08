package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.login-protection.address.max-failures=3")
class CredentialProofRateLimitTest extends AbstractIntegrationTest {

    private static final String ADDRESS = "192.0.2.44";

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        account("victim", "victim-password");
        account("attacker", "attacker-password");
    }

    @Test
    void givenTwoAccountsAtOneAddress_whenOneProvesItsPassword_thenItCannotResetTheOthersLimit()
            throws Exception {
        // given
        MockHttpSession victim = signIn("victim", "victim-password");
        MockHttpSession attacker = signIn("attacker", "attacker-password");
        reauthenticate(victim, "wrong-password").andExpect(status().isForbidden());
        reauthenticate(victim, "still-wrong").andExpect(status().isForbidden());

        // when
        reauthenticate(attacker, "attacker-password").andExpect(status().isNoContent());

        // then
        reauthenticate(victim, "source-is-still-limited")
                .andExpect(status().isTooManyRequests());
        reauthenticate(victim, "third-guess", "192.0.2.45").andExpect(status().isForbidden());
        reauthenticate(victim, "fourth-guess", "192.0.2.46")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-verification-rate-limited"));
    }

    @Test
    void givenOneAccountFromChangingAddresses_whenItKeepsGuessing_thenTheAccountLimitApplies()
            throws Exception {
        // given
        MockHttpSession victim = signIn("victim", "victim-password");
        reauthenticate(victim, "wrong-password", "2001:db8::1").andExpect(status().isForbidden());
        reauthenticate(victim, "still-wrong", "2001:db8::2").andExpect(status().isForbidden());
        reauthenticate(victim, "yet-another-guess", "2001:db8::3").andExpect(status().isForbidden());

        // when / then
        reauthenticate(victim, "fourth-guess", "2001:db8::4")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-verification-rate-limited"));
    }

    @Test
    void givenAnAccountProvesItsPassword_whenItTriesAgain_thenOnlyItsAccountBudgetStartsAgain()
            throws Exception {
        // given
        MockHttpSession victim = signIn("victim", "victim-password");
        reauthenticate(victim, "wrong-password", "192.0.2.50").andExpect(status().isForbidden());
        reauthenticate(victim, "still-wrong", "192.0.2.51").andExpect(status().isForbidden());

        // when
        reauthenticate(victim, "victim-password", "192.0.2.52").andExpect(status().isNoContent());

        // then
        reauthenticate(victim, "first-new-guess", "192.0.2.53").andExpect(status().isForbidden());
        reauthenticate(victim, "second-new-guess", "192.0.2.54").andExpect(status().isForbidden());
        reauthenticate(victim, "third-new-guess", "192.0.2.55").andExpect(status().isForbidden());
        reauthenticate(victim, "fourth-new-guess", "192.0.2.56")
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void givenAnAccountOnItsOneTimePassword_whenItsProofIsRefused_thenTheAddressBudgetIsUntouched()
            throws Exception {
        // given
        Person newcomer = persons.save(new Person("Mary", "Major", "mary@example.org"));
        UserAccount issued = enabled(new UserAccount(newcomer, "newcomer",
                passwordEncoder.encode("issued-password"), Set.of(Role.MEMBER), "en"));
        issued.requirePasswordChange();
        accounts.save(issued);
        MockHttpSession beforeReplacing = signIn("newcomer", "issued-password");
        MockHttpSession victim = signIn("victim", "victim-password");

        // when
        for (int refused = 0; refused < 3; refused++) {
            reauthenticate(beforeReplacing, "issued-password")
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        }

        // then
        reauthenticate(victim, "wrong-password").andExpect(status().isForbidden());
        reauthenticate(victim, "still-wrong").andExpect(status().isForbidden());
        reauthenticate(victim, "yet-another-guess").andExpect(status().isForbidden());
        reauthenticate(victim, "fourth-guess")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-verification-rate-limited"));
    }

    private void account(String username, String password) {
        Person person = persons.save(new Person(username, "Member", username + "@example.org"));
        accounts.save(enabled(new UserAccount(person, username, passwordEncoder.encode(password),
                Set.of(Role.MEMBER), "en")));
    }

    private MockHttpSession signIn(String username, String password) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .with(request -> {
                            request.setRemoteAddr(ADDRESS);
                            return request;
                        })
                        .param("username", username).param("password", password).with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private org.springframework.test.web.servlet.ResultActions reauthenticate(
            MockHttpSession session, String password) throws Exception {
        return reauthenticate(session, password, ADDRESS);
    }

    private org.springframework.test.web.servlet.ResultActions reauthenticate(
            MockHttpSession session, String password, String address) throws Exception {
        return mockMvc.perform(post("/api/session/reauthentication")
                .with(request -> {
                    request.setRemoteAddr(address);
                    return request;
                })
                .session(session).with(csrf()).contentType("application/json")
                .content("{\"password\":\"" + password + "\"}"));
    }
}
