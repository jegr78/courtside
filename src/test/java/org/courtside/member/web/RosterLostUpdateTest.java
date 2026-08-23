package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.RosterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class RosterLostUpdateTest extends AbstractIntegrationTest {

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

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAUsernameCorrectionInFlight_whenAPasswordResetLandsOnTheSameAccount_thenItIsRefused()
            throws Exception {
        // given
        UUID jane = accountHolder();
        CountDownLatch corrected = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> correction = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeUsername(jane, "doe.j");
                        corrected.countDown();
                        await(allowCommit);
                    }));
            assertThat(corrected.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> reset = pool.submit(() -> roster.requestCredentials(jane));

            // then
            assertThatThrownBy(() -> reset.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            correction.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> reset.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(OptimisticLockingFailureException.class);
            assertThat(accounts.findByUsername("doe.j")).isPresent();
            assertThat(accounts.findByUsername("doe.jane")).isEmpty();
        } finally {
            allowCommit.countDown();
        }
    }

    @Test
    void givenAUsernameCorrectionInFlight_whenAPasswordResetIsRequested_thenTheAnswerIsTranslatable()
            throws Exception {
        // given
        UUID jane = accountHolder();
        CountDownLatch corrected = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> correction = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        roster.changeUsername(jane, "doe.j");
                        corrected.countDown();
                        await(allowCommit);
                    }));
            assertThat(corrected.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<MockHttpServletResponse> reset = pool.submit(() -> mockMvc.perform(
                            put("/api/admin/roster/{personId}/account/password", jane)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"oneTimePassword": "another-password"}
                                            """)
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andReturn().getResponse());

            // then
            assertThatThrownBy(() -> reset.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            correction.get(5, TimeUnit.SECONDS);
            MockHttpServletResponse response = reset.get(5, TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(409);
            assertThat(response.getContentAsString())
                    .contains("urn:courtside:error:concurrent-modification")
                    .contains("request.concurrentModification");
        } finally {
            allowCommit.countDown();
        }
    }

    private UUID accountHolder() {
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        return jane;
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
