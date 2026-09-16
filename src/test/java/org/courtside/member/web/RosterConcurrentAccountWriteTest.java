package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.RosterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class RosterConcurrentAccountWriteTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private RosterService roster;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAUsernameCorrectionInFlight_whenARoleChangeLandsOnTheSameAccount_thenBothSurvive()
            throws Exception {
        // given
        UUID jane = accountHolder();
        CountDownLatch corrected = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> correction = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeUsername(jane, "doe.j");
                        corrected.countDown();
                        await(allowCommit);
                    }));
            assertThat(corrected.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> roleChange = pool.submit(() ->
                    roster.changeRoles(jane, Set.of(Role.MEMBER, Role.TRAINER)));

            // then
            assertThatThrownBy(() -> roleChange.get(250, TimeUnit.MILLISECONDS))
                    .as("the role change was already finished, so what follows says nothing "
                            + "about the writers meeting each other")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            correction.get(5, TimeUnit.SECONDS);
            assertThat(roleChange)
                    .as("the role change was refused for a conflict with a write it could have "
                            + "waited for, and the board was told to load the entry again")
                    .succeedsWithin(Duration.ofSeconds(5));
            assertThat(accounts.findByUsername("doe.jane")).isEmpty();
            assertThat(accounts.findByUsername("doe.j")).get()
                    .satisfies(account -> assertThat(account.getRoles())
                            .as("the later write was built on a stale read and dropped the "
                                    + "correction, or the correction dropped the roles")
                            .containsExactlyInAnyOrder(Role.MEMBER, Role.TRAINER));
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenARoleChangeInFlight_whenAnotherReplacesTheSameField_thenTheLaterOneStands()
            throws Exception {
        // given
        UUID jane = accountHolder();
        CountDownLatch firstChanged = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeRoles(jane, Set.of(Role.MEMBER, Role.TRAINER));
                        firstChanged.countDown();
                        await(allowCommit);
                    }));
            assertThat(firstChanged.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> second = pool.submit(() -> roster.changeRoles(jane, Set.of(Role.TREASURER)));

            // then
            allowCommit.countDown();
            first.get(5, TimeUnit.SECONDS);
            assertThat(second)
                    .as("two boards replacing the same field is refused rather than ordered")
                    .succeedsWithin(Duration.ofSeconds(5));
            assertThat(accounts.findByUsername("doe.jane")).get()
                    .satisfies(account -> assertThat(account.getRoles())
                            .as("the earlier replacement stood, so the board that wrote last saw "
                                    + "its own change disappear without being told")
                            .containsExactly(Role.TREASURER));
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    @Test
    void givenAUsernameCorrectionInFlight_whenTheRolesAreReplacedOverHttp_thenItIsAnswered()
            throws Exception {
        // given
        UUID jane = accountHolder();
        CountDownLatch corrected = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);
        MockHttpSession adminSession = signInAdmin();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> correction = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeUsername(jane, "doe.j");
                        corrected.countDown();
                        await(allowCommit);
                    }));
            assertThat(corrected.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<MockHttpServletResponse> roleChange = pool.submit(() -> mockMvc.perform(
                            put("/api/admin/roster/{personId}/account/roles", jane)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"roles": ["MEMBER", "TRAINER"]}
                                            """)
                                    .session(adminSession)
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andReturn().getResponse());

            // then
            assertThatThrownBy(() -> roleChange.get(250, TimeUnit.MILLISECONDS))
                    .as("the request was already finished, so what follows says nothing "
                            + "about the writers meeting each other")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            correction.get(5, TimeUnit.SECONDS);
            MockHttpServletResponse response = roleChange.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatus())
                    .as("the board was answered with a conflict over a write nobody else made")
                    .isEqualTo(200);
            assertThat(response.getContentAsString())
                    .doesNotContain("urn:courtside:error:concurrent-modification")
                    .doesNotContain("doe.jane")
                    .contains("\"doe.j\"")
                    .contains("TRAINER");
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
    }

    private UUID accountHolder() {
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        return jane;
    }

    private MockHttpSession signInAdmin() throws Exception {
        UUID admin = identity.createPerson("Ada", "Admin", "ada.admin@example.org");
        identity.createEnabledAccount(admin, "admin", passwordEncoder.encode("admin-password"),
                Set.of(Role.ADMIN));
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", "admin")
                        .param("password", "admin-password")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out while coordinating concurrent transactions");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while coordinating concurrent transactions", e);
        }
    }
}
