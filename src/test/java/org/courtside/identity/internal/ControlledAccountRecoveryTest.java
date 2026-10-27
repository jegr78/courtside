package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.MediaType;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ControlledAccountRecoveryTest extends AbstractIntegrationTest {
    @Autowired private ControlledAccountRecovery recovery;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private MfaRecoveryCodeRepository codes;
    @Autowired private PasswordResetTokenService reset;
    @Autowired private AccountCredentialIssuer credentials;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    @Autowired private WebApplicationContext web;
    @Autowired private org.springframework.transaction.PlatformTransactionManager transactions;
    private List<String> initialCodes;
    private UUID account;
    private String username;

    @BeforeEach
    void createAccount() {
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        username = "doe.jane";
        UserAccount holder = new UserAccount(jane, username, passwords.encode("previous-password"), Set.of(Role.ADMIN), "en");
        holder.enable();
        account = accounts.save(holder).getId();
        totp.begin(account);
        jdbc.sql("UPDATE account_mfa SET totp_secret = pending_totp_secret, pending_totp_secret = NULL, pending_totp_expires_at = NULL WHERE account_id = :id")
                .param("id", account).update();
        initialCodes = MfaRecoveryCodes.generate();
        codes.replace(account, initialCodes);
    }

    @Test
    void givenLostFactors_whenMaintenanceStartsRecovery_thenOldFactorsRemainAndOnlyAPasswordRedemptionRemovesThem() {
        // given
        long before = accounts.findById(account).orElseThrow().getSecurityEpoch();
        // when
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        // then
        assertThat(jdbc.sql("SELECT code_hash FROM account_mfa_recovery WHERE account_id = :id")
                .param("id", account).query(String.class).single())
                .isEqualTo(ResetCodes.fingerprint("MFA_ACCOUNT_RESCUE:" + code));
        assertThat(jdbc.sql("SELECT count(*) FROM message_record WHERE account_id = :id AND kind = 'ACCOUNT_MFA_RECOVERY_CODE'")
                .param("id", account).query(Integer.class).single()).isOne();
        assertThat(pending()).isTrue();
        assertThat(totp.enabled(account)).isTrue();
        assertThat(codes.remaining(account)).isEqualTo(10);
        assertThat(accounts.findById(account).orElseThrow().getSecurityEpoch()).isGreaterThan(before);
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.1"))
                .isEqualTo(ControlledAccountRecovery.Redemption.ACCEPTED);
        assertThat(pending()).isFalse();
        assertThat(totp.enabled(account)).isFalse();
        assertThat(codes.remaining(account)).isZero();
        UserAccount updated = accounts.findById(account).orElseThrow();
        assertThat(updated.isPasswordChangeRequired()).isFalse();
        assertThat(passwords.matches("another-unusual-password", updated.getPasswordHash())).isTrue();
        assertThat(jdbc.sql("SELECT count(*) FROM notification WHERE account_id = :id AND kind = 'ACCOUNT_SECURITY_CHANGED'")
                .param("id", account).query(Integer.class).single()).isOne();
        assertThat(recovery.redeem(username, code, "yet-another-unusual-password", "198.51.100.1"))
                .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
    }

    @Test
    void givenPendingRecovery_whenNormalResetOrCredentialIssuanceRuns_thenNeitherInvalidatesTheRecovery() {
        // given
        String oldCode = reset.issueFor(account).code();
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        long epoch = accounts.findById(account).orElseThrow().getSecurityEpoch();
        // when / then
        assertThatThrownBy(() -> reset.redeem(oldCode, "another-unusual-password")).isInstanceOf(ResetCodeInvalidException.class);
        assertThatThrownBy(() -> reset.issueFor(account)).isInstanceOf(ResetCodeInvalidException.class);
        assertThatThrownBy(() -> credentials.issueFor(account, java.time.Instant.now().plusSeconds(300), issued -> {
            throw new AssertionError("A temporary credential must not be mailed during recovery");
        })).isInstanceOf(ResetCodeInvalidException.class);
        assertThat(accounts.findById(account).orElseThrow().getSecurityEpoch()).isEqualTo(epoch);
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.2"))
                .isEqualTo(ControlledAccountRecovery.Redemption.ACCEPTED);
    }

    @Test
    void givenPendingRecovery_whenThePasswordIsRejected_thenTheCodeAndFactorsRemainUsable() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        // when / then
        assertThatThrownBy(() -> recovery.redeem(username, code, "password", "198.51.100.3"))
                .isInstanceOf(GuessablePasswordException.class);
        assertThat(pending()).isTrue();
        assertThat(totp.enabled(account)).isTrue();
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.3"))
                .isEqualTo(ControlledAccountRecovery.Redemption.ACCEPTED);
    }

    @Test
    void givenOneCode_whenTwoRedemptionsRace_thenOnlyOneCanReplaceThePassword() throws Exception {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        var second = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<ControlledAccountRecovery.Redemption>>();
        // when
        try (var executor = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(status -> {
                assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.4"))
                        .isEqualTo(ControlledAccountRecovery.Redemption.ACCEPTED);
                second.set(executor.submit(() -> recovery.redeem(username, code, "different-unusual-password", "198.51.100.5")));
                awaitBlockedRedemption();
            });
            // then
            assertThat(second.get().get(30, java.util.concurrent.TimeUnit.SECONDS))
                    .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        }
    }

    @Test
    void givenRepeatedGuessesAcrossRecoveryRequests_whenTheBudgetIsSpent_thenTheValidCodeIsLimited() {
        // given
        for (int guess = 0; guess < 25; guess++) {
            recovery.redeem(username, "wrong-code", "another-unusual-password", "198.51.100.6");
        }
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        // when / then
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.6"))
                .isEqualTo(ControlledAccountRecovery.Redemption.LIMITED);
        assertThat(pending()).isTrue();
    }

    @Test
    void givenUnconfirmedIdentity_whenMaintenanceStartsRecovery_thenNothingChanges() {
        // given / when / then
        assertThatThrownBy(() -> recovery.initiateFromMaintenance(account, false)).isInstanceOf(MfaProofFailedException.class);
        assertThat(pending()).isFalse();
        assertThat(totp.enabled(account)).isTrue();
    }

    @Test
    void givenFreshMfaAdministrator_whenIdentityWasChecked_thenRecoveryStarts() {
        // given
        authenticate(accounts.findById(account).orElseThrow(), 0);
        // when
        recovery.initiate(account, true);
        // then
        assertThat(pending()).isTrue();
        assertThat(totp.enabled(account)).isTrue();
    }

    @Test
    void givenExpiredMfaProof_whenAdministratorRequestsRecovery_thenItIsRefused() {
        // given
        authenticate(accounts.findById(account).orElseThrow(), 360);
        // when / then
        assertThatThrownBy(() -> recovery.initiate(account, true))
                .isInstanceOf(org.courtside.identity.RecentAuthenticationRequiredException.class);
        assertThat(pending()).isFalse();
    }

    @Test
    void givenAdministratorWithoutMfa_whenRequestingRecovery_thenItIsRefused() {
        // given
        Person john = people.save(new Person("John", "Roe", "john.roe@example.org"));
        UserAccount actor = new UserAccount(john, "roe.john", passwords.encode("another-password"), Set.of(Role.ADMIN), "en");
        actor.enable();
        authenticate(accounts.save(actor), 0);
        // when / then
        assertThatThrownBy(() -> recovery.initiate(account, true)).isInstanceOf(MfaProofFailedException.class);
        assertThat(pending()).isFalse();
    }

    @Test
    void givenExpiredOrStaleCode_whenRedeemed_thenFactorsRemainAndTheReasonIsBounded() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        jdbc.sql("UPDATE account_mfa_recovery SET expires_at = :expiry WHERE account_id = :id")
                .param("expiry", clock.instant().minusSeconds(1).atOffset(java.time.ZoneOffset.UTC)).param("id", account).update();
        // when / then
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.7"))
                .isEqualTo(ControlledAccountRecovery.Redemption.EXPIRED);
        assertThat(pending()).isTrue();
        assertThat(totp.enabled(account)).isTrue();
        jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id").param("id", account).update();
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.8"))
                .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
    }

    @Test
    void givenCorrectedAddress_whenOldCodeIsRedeemed_thenItCannotReachTheAccount() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String oldCode = recovery.issueFor(account, request).code();
        // when
        recovery.correctEmailFromMaintenance(account, "john.roe@example.org", true);
        // then
        assertThat(recovery.redeem(username, oldCode, "another-unusual-password", "198.51.100.9"))
                .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        assertThat(pending()).isTrue();
        UUID replacement = recovery.initiateFromMaintenance(account, true);
        assertThat(recovery.issueFor(account, replacement).recipientAddress()).isEqualTo("john.roe@example.org");
        assertThatThrownBy(() -> recovery.correctEmailFromMaintenance(account, "not-an-address", true))
                .isInstanceOf(MfaProofFailedException.class);
    }

    @Test
    void givenMfaAndNormalPasswordReset_whenRedeemed_thenMfaRemainsEnabled() {
        // given
        String code = reset.issueFor(account).code();
        // when
        reset.redeem(code, "another-unusual-password");
        // then
        assertThat(totp.enabled(account)).isTrue();
        assertThat(codes.remaining(account)).isEqualTo(10);
    }

    @Test
    void givenAnAuthenticatedHolder_whenRecoveryStarts_thenOldSessionsAndPasswordLoginAreBlocked() throws Exception {
        // given
        var mvc = MockMvcBuilders.webAppContextSetup(web)
                .apply(springSecurity()).build();
        var pending = (MockHttpSession) mvc.perform(
                post("/api/session")
                        .with(csrf())
                        .param("username", username).param("password", "previous-password"))
                .andExpect(status().isAccepted())
                .andReturn().getRequest().getSession(false);
        var full = (MockHttpSession) mvc.perform(
                post("/api/session/mfa").session(pending)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + initialCodes.getFirst() + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
        // when
        recovery.initiateFromMaintenance(account, true);
        // then
        mvc.perform(get("/api/session").session(full))
                .andExpect(jsonPath("$.authenticated").value(false));
        mvc.perform(post("/api/session")
                        .with(csrf())
                        .param("username", username).param("password", "previous-password"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenStoredWebAuthnAndChallenges_whenRecoveryIsRedeemed_thenAllOldFactorsAndChallengesAreRemoved() {
        // given
        jdbc.sql("INSERT INTO user_entities (id, account_id, name) VALUES ('recovery-holder', :id, :username)")
                .param("id", account).param("username", username).update();
        jdbc.sql("""
                INSERT INTO user_credentials (credential_id, user_entity_user_id, public_key, signature_count,
                    uv_initialized, backup_eligible, public_key_credential_type, backup_state,
                    attestation_object, attestation_client_data_json, created, last_used, label)
                VALUES ('recovery-credential', 'recovery-holder', decode('01', 'hex'), 0, true, false,
                    'public-key', false, decode('01', 'hex'), decode('01', 'hex'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Security key')
                """).update();
        jdbc.sql("""
                INSERT INTO mfa_challenge (id, account_id, security_epoch, purpose, session_hash, expires_at, payload)
                VALUES (:challenge, :id, 0, 'LOGIN', repeat('a', 64), CURRENT_TIMESTAMP, '{}')
                """).param("challenge", UUID.randomUUID()).param("id", account).update();
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        assertThat(jdbc.sql("SELECT count(*) FROM user_credentials").query(Integer.class).single()).isOne();
        // when
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.10"))
                .isEqualTo(ControlledAccountRecovery.Redemption.ACCEPTED);
        // then
        assertThat(jdbc.sql("SELECT count(*) FROM user_credentials").query(Integer.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM mfa_challenge WHERE account_id = :id")
                .param("id", account).query(Integer.class).single()).isZero();
    }

    @Test
    void givenAnAccountCachedBeforeRevocation_whenItsOldRecoveryCodeIsRedeemed_thenTheCurrentEpochWins() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        // when / then
        transaction.executeWithoutResult(status -> {
            accounts.findById(account).orElseThrow();
            jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id").param("id", account).update();
            assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.11"))
                    .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        });
        assertThat(pending()).isTrue();
        assertThat(totp.enabled(account)).isTrue();
    }

    @Test
    void givenAddressChangedWithoutAnEpochChange_whenOldRecoveryCodeIsRedeemed_thenItsAddressBindingRefusesIt() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        jdbc.sql("UPDATE person SET email = 'john.roe@example.org' WHERE id = :id")
                .param("id", accounts.findById(account).orElseThrow().getPerson().getId()).update();
        // when / then
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.12"))
                .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        assertThat(totp.enabled(account)).isTrue();
    }

    @Test
    void givenDisabledAccountWithoutAnEpochChange_whenRecoveryCodeIsRedeemed_thenItIsRefused() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        jdbc.sql("UPDATE user_account SET enabled = false WHERE id = :id").param("id", account).update();
        // when / then
        assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.13"))
                .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        assertThat(totp.enabled(account)).isTrue();
    }

    @Test
    void givenAnMfaMemberWithFreshProof_whenTheyInitiateRecovery_thenAdministratorAuthorityIsRequired() {
        // given
        UserAccount holder = accounts.findById(account).orElseThrow();
        holder.changeRoles(Set.of(Role.MEMBER));
        accounts.saveAndFlush(holder);
        authenticate(holder, 0);
        // when / then
        assertThatThrownBy(() -> recovery.initiate(account, true)).isInstanceOf(MfaProofFailedException.class);
        assertThat(pending()).isFalse();
    }

    @Test
    void givenACachedPersonBeforeAnAddressCorrection_whenAnOldCodeIsRedeemed_thenTheCurrentAddressWins() {
        // given
        UUID request = recovery.initiateFromMaintenance(account, true);
        String code = recovery.issueFor(account, request).code();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        // when / then
        transaction.executeWithoutResult(status -> {
            UserAccount cached = accounts.findById(account).orElseThrow();
            assertThat(cached.getPerson().getEmail()).isEqualTo("jane.doe@example.org");
            jdbc.sql("UPDATE person SET email = 'john.roe@example.org' WHERE id = :id")
                    .param("id", cached.getPerson().getId()).update();
            assertThat(recovery.redeem(username, code, "another-unusual-password", "198.51.100.14"))
                    .isEqualTo(ControlledAccountRecovery.Redemption.INVALID);
        });
        assertThat(pending()).isTrue();
    }

    private void authenticate(UserAccount actor, long ageSeconds) {
        var principal = new CourtsideUserDetails(actor.getId(), actor.getUsername(), actor.getPasswordHash(),
                true, true, List.of("ROLE_ADMIN"), actor.getSecurityEpoch());
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
        var request = new MockHttpServletRequest();
        request.getSession().setAttribute("courtside.authenticated-at", clock.instant().minusSeconds(ageSeconds).toEpochMilli());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void clearPrincipal() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    private void awaitBlockedRedemption() {
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
            if (jdbc.sql("SELECT count(*) FROM pg_stat_activity WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))")
                    .query(Integer.class).single() > 0) return;
            java.util.concurrent.locks.LockSupport.parkNanos(java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(20));
        }
        throw new AssertionError("The second redemption never waited for the first PostgreSQL transaction");
    }

    private boolean pending() {
        return jdbc.sql("SELECT recovery_pending FROM account_mfa WHERE account_id = :id")
                .param("id", account).query(Boolean.class).single();
    }
}
