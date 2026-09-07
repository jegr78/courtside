package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.login-protection.address.max-failures=2")
class BreachCheckAvailabilityTest extends AbstractIntegrationTest {

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcClient jdbc;
    @MockitoBean private BreachedPasswordLookup breachedPasswords;

    private MockMvc mockMvc;
    private UserAccount account;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        account = new UserAccount(person, "doe.jane",
                passwordEncoder.encode("current-password"), Set.of(Role.MEMBER), "en");
        account.enable();
        account = accounts.save(account);
        when(breachedPasswords.isBreached(anyString()))
                .thenThrow(new BreachedPasswordCheckUnavailableException());
    }

    @Test
    void givenAnUnavailableBreachService_whenCredentialsAreUsed_thenOnlyPasswordChangesAreBlocked()
            throws Exception {
        // given / when
        MockHttpSession session = (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", "current-password").with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        int globalAttempts = globalAttempts();

        // then
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"current-password\","
                                + "\"newPassword\":\"lattice-marmoset-vellum\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-breach-check-unavailable"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("identity.password.breachCheckUnavailable"));

        // when / then — an external outage must not spend the independent sign-in limit
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"current-password\","
                                + "\"newPassword\":\"another-lattice-marmoset-vellum\"}"))
                .andExpect(status().isServiceUnavailable());
        mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"current-password\","
                                + "\"newPassword\":\"third-lattice-marmoset-vellum\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-verification-rate-limited"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("identity.passwordVerification.rateLimited"));
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", "current-password").with(csrf()))
                .andExpect(status().isOk());
        assertThat(globalAttempts()).isEqualTo(globalAttempts + 1);
    }

    @Test
    void givenAnUnavailableBreachService_whenAnInitialPasswordIsChosen_thenItFailsClosed()
            throws Exception {
        // given
        account.requirePasswordChange();
        accounts.save(account);
        MockHttpSession session = (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", "current-password").with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);

        // when / then
        mockMvc.perform(put("/api/account/initial-password").session(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"password\":\"lattice-marmoset-vellum\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-breach-check-unavailable"));

        // then
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", "current-password").with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    void givenEveryCredentialProofSlotWaitsForBreachData_whenLoginArrives_thenItStillSucceeds()
            throws Exception {
        // given
        Person secondPerson = persons.save(new Person("Alex", "Smith", "alex.smith@example.org"));
        UserAccount secondAccount = new UserAccount(secondPerson, "smith.alex",
                passwordEncoder.encode("second-password"), Set.of(Role.MEMBER), "en");
        secondAccount.enable();
        accounts.save(secondAccount);
        MockHttpSession first = signIn("doe.jane", "current-password");
        MockHttpSession second = signIn("smith.alex", "second-password");
        CountDownLatch waitingForBreachData = new CountDownLatch(2);
        CountDownLatch releaseBreachData = new CountDownLatch(1);
        doAnswer(invocation -> {
            waitingForBreachData.countDown();
            if (!releaseBreachData.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Coordinated breach lookup was not released");
            }
            return false;
        }).when(breachedPasswords).isBreached(anyString());

        // when
        try (var executor = Executors.newFixedThreadPool(2)) {
            var firstChange = executor.submit(() -> change(first, "current-password",
                    "lattice-marmoset-vellum"));
            var secondChange = executor.submit(() -> change(second, "second-password",
                    "granite-tapestry-orchard"));
            assertThat(waitingForBreachData.await(5, TimeUnit.SECONDS)).isTrue();

            // then
            signIn("doe.jane", "current-password");
            releaseBreachData.countDown();
            assertThat(firstChange.get(10, TimeUnit.SECONDS)).isEqualTo(204);
            assertThat(secondChange.get(10, TimeUnit.SECONDS)).isEqualTo(204);
        } finally {
            releaseBreachData.countDown();
        }
    }

    private MockHttpSession signIn(String username, String password) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", username).param("password", password).with(csrf()))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private int change(MockHttpSession session, String currentPassword, String replacement)
            throws Exception {
        return mockMvc.perform(put("/api/account/password").session(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"" + currentPassword
                                + "\",\"newPassword\":\"" + replacement + "\"}"))
                .andReturn().getResponse().getStatus();
    }

    private int globalAttempts() {
        return jdbc.sql("SELECT COALESCE(SUM(attempt_count), 0) FROM login_attempt_limit WHERE scope = 'GLOBAL'")
                .query(Integer.class).single();
    }
}
