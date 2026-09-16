package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.CredentialIssuer;
import org.courtside.shared.IssuedCredential;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.InstanceOfAssertFactories.type;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(IdentityTestFixture.class)
class OwnAccountWriteHandoverRaceTest extends AbstractIntegrationTest {

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CredentialIssuer credentials;

    @Autowired
    private AccountLocaleService locales;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID accountId;
    private long epochBefore;

    @BeforeEach
    void createASignedInMember() {
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        accountId = identity.createEnabledAccount(jane, "doe.jane",
                passwordEncoder.encode("correct-horse-battery-staple"), Set.of(Role.MEMBER));
        epochBefore = identity.securityEpoch(accountId);
    }

    @Test
    void givenTheHandoverInFlight_whenTheMemberChangesTheirOwnLanguage_thenItWaits()
            throws Exception {
        // given
        CountDownLatch credentialIssued = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<IssuedCredential> handover = pool.submit(() -> new TransactionTemplate(transactions)
                    .execute(status -> {
                        AtomicReference<IssuedCredential> handedOver = new AtomicReference<>();
                        credentials.issueFor(accountId, Instant.now().plus(7, ChronoUnit.DAYS),
                                handedOver::set);
                        IssuedCredential issued = handedOver.get();
                        credentialIssued.countDown();
                        await(allowCommit);
                        return issued;
                    }));
            assertThat(credentialIssued.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> ownChange = pool.submit(() -> {
                identity.signInAs("doe.jane");
                locales.change("en");
            });

            // then
            assertThatThrownBy(() -> ownChange.get(250, TimeUnit.MILLISECONDS))
                    .as("the member's own change was already finished, so what follows says "
                            + "nothing about the writers meeting each other")
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            IssuedCredential issued = assertThat(handover)
                    .as("the handover lost to a member editing their own account, so no credential "
                            + "was issued and nobody was told")
                    .succeedsWithin(Duration.ofSeconds(5), type(IssuedCredential.class))
                    .actual();
            assertThat(ownChange)
                    .as("the member was refused for a conflict with a write of their own account "
                            + "that nobody else made")
                    .succeedsWithin(Duration.ofSeconds(5));
            assertThat(identity.securityEpoch(accountId))
                    .as("a language change leaves a session standing, so the handover's revocation "
                            + "is the only one, and it either went missing or happened twice")
                    .isEqualTo(epochBefore + 1);
            assertThat(identity.credentialSignsIn(accountId, issued.credential()))
                    .as("the language change overwrote the credential the handover had stored")
                    .isTrue();
            assertThat(accounts.findById(accountId)).get()
                    .satisfies(account -> assertThat(account.getLocale())
                            .as("the handover overwrote the language the member chose")
                            .isEqualTo("en"));
        } finally {
            allowCommit.countDown();
            pool.shutdown();
        }
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
