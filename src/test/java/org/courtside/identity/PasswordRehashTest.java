package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static java.util.stream.Collectors.toMap;
import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PasswordRehashTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private UserDetailsPasswordService passwordService;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAHashBelowTheCurrentCost_whenThePasswordIsUpdated_thenItIsStoredAtTheCurrentCost() {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = accounts.save(new UserAccount(
                person, "doe.jane", weaker.encode(PASSWORD), Set.of(Role.MEMBER)));

        // when
        UserDetails details = userDetailsService.loadUserByUsername("doe.jane");
        passwordService.updatePassword(details, passwordEncoder.encode(PASSWORD));

        // then
        String stored = accounts.findById(account.getId()).orElseThrow().getPasswordHash();
        assertThat(stored).contains("m=19456");
        assertThat(passwordEncoder.matches(PASSWORD, stored))
                .as("the member must still be able to sign in with the same password")
                .isTrue();
    }

    @Test
    void givenAPasswordChangeCommittedAfterTheHashWasRead_whenTheStaleHashIsRehashed_thenTheNewerHashIsNotOverwritten() {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = accounts.save(new UserAccount(
                person, "doe.jane", weaker.encode(PASSWORD), Set.of(Role.MEMBER)));
        UserDetails details = userDetailsService.loadUserByUsername("doe.jane");

        String concurrentHash = passwordEncoder.encode("a-different-password");
        jdbc.sql("UPDATE user_account SET password_hash = :hash WHERE id = :id")
                .param("hash", concurrentHash)
                .param("id", account.getId())
                .update();

        // when
        passwordService.updatePassword(details, passwordEncoder.encode(PASSWORD));

        // then
        assertThat(accounts.findById(account.getId()).orElseThrow().getPasswordHash())
                .as("a rehash of the hash a concurrent change already replaced must not win")
                .isEqualTo(concurrentHash);
    }

    @Test
    void givenAHashBelowTheCurrentCost_whenTheMemberSignsIn_thenSpringSecurityStoresTheStrongerHash()
            throws Exception {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person person = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        UserAccount account = accounts.save(enabled(new UserAccount(
                person, "roe.john", weaker.encode(PASSWORD), Set.of(Role.MEMBER))));

        // when
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "roe.john")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        assertThat(accounts.findById(account.getId()).orElseThrow().getPasswordHash())
                .as("signing in must raise the stored cost without a further step")
                .contains("m=19456");
    }

    @Test
    void givenTwoAccountsAtDifferentCosts_whenBothMembersSignIn_thenTheResponsesAreIndistinguishable()
            throws Exception {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person legacy = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        accounts.save(enabled(new UserAccount(
                legacy, "roe.john", weaker.encode(PASSWORD), Set.of(Role.MEMBER))));
        Person current = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        accounts.save(enabled(new UserAccount(
                current, "major.mary", passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER))));

        // when
        MockHttpServletResponse legacyResponse = signIn("roe.john");
        MockHttpServletResponse currentResponse = signIn("major.mary");

        // then
        assertThat(legacyResponse.getStatus()).isEqualTo(currentResponse.getStatus());
        assertThat(legacyResponse.getHeaderNames())
                .as("the set of response headers must not reveal that a hash was below the current cost")
                .containsExactlyInAnyOrderElementsOf(currentResponse.getHeaderNames());
        assertThat(headersOtherThanCookies(legacyResponse))
                .as("no response header value may reveal that a hash was below the current cost")
                .isEqualTo(headersOtherThanCookies(currentResponse));
    }

    private MockHttpServletResponse signIn(String username) throws Exception {
        return mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", username)
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andReturn()
                .getResponse();
    }

    private Map<String, List<String>> headersOtherThanCookies(MockHttpServletResponse response) {
        return response.getHeaderNames().stream()
                .filter(name -> !HttpHeaders.SET_COOKIE.equalsIgnoreCase(name))
                .collect(toMap(name -> name, response::getHeaders));
    }
}
