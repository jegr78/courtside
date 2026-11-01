package org.courtside.identity.internal;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import java.util.List;
import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.bouncycastle.util.encoders.Base32;
import org.courtside.api.ApiMfaRecoveryCodeSet;
import org.courtside.api.ApiTotpEnrollment;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
class MfaWebAuthnFlowTest extends AbstractIntegrationTest {
    private static final String ORIGIN = "https://courts.example.org";
    @Autowired private WebApplicationContext context;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @Autowired private SessionRepository<? extends Session> sessions;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaWebAuthnCodec codec;
    @Autowired private MfaWebAuthnCredentials credentials;
    @Autowired private MfaWebAuthn webAuthn;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    @Autowired private MfaTotpRepository totp;
    @Autowired private MfaRecoveryCodeRepository recovery;
    @Autowired private LoginAttemptProtection attempts;
    @Autowired private MfaWebAuthnFlow flow;
    private MockMvc mvc;
    private UUID account;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(storedSessions).apply(springSecurity()).build();
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount holder = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"), Set.of(Role.MEMBER), "en");
        holder.enable();
        account = accounts.save(holder).getId();
    }

    @Test
    void givenNoTotp_whenEnrollingAndUsingWebAuthn_thenPasswordAndTheEnrolledKeyGrantAccountAccess() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        // when
        var options = options(pending);
        Cookie full = prove(pending, authenticator, options);
        // then
        mvc.perform(get("/api/session").cookie(full)).andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.mfaEnabled").value(true)).andExpect(jsonPath("$.totpAvailable").value(false));
        mvc.perform(get("/api/account/mfa").cookie(full)).andExpect(status().isOk())
                .andExpect(jsonPath("$.devices[0].label").value("Private security key"));
        mvc.perform(get("/api/session").cookie(pending)).andExpect(jsonPath("$.authenticated").value(false));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(1);
    }

    @Test
    void givenAnExpiredChallenge_whenASignedAssertionArrives_thenItCannotAdvanceTheCredentialCounter() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        var options = options(pending);
        jdbc.sql("UPDATE mfa_challenge SET expires_at = :now WHERE account_id = :id")
                .param("now", clock.instant().atOffset(ZoneOffset.UTC)).param("id", account).update();
        // when
        List<String> reasons = securityEventValues("event.reason", () -> mvc.perform(post("/api/session/mfa/webauthn")
                        .cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, ORIGIN))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed")));
        // then
        assertThat(reasons).as("a key proof against an expired challenge is audited").containsExactly("MFA_PROOF_FAILED");
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
    }

    @Test
    void givenARevokedChallenge_whenASignedAssertionArrives_thenTheNewSecurityEpochWins() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        var options = options(pending);
        jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id")
                .param("id", account).update();
        // when / then
        mvc.perform(post("/api/session/mfa/webauthn").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, ORIGIN))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void givenAWebAuthnSessionWithExpiredProof_whenReauthenticating_thenPasswordAndTheKeyAreBothRequired(
            boolean blankCode) throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        expire(sessions, full);
        // when / then
        mvc.perform(post("/api/session/reauthentication").cookie(full).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
        String json = mvc.perform(post("/api/account/mfa/webauthn/authentication-options").cookie(full).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var options = codec.decode(json, PublicKeyCredentialRequestOptions.class);
        String code = blankCode ? ",\"code\":\"   \"" : "";
        var result = mvc.perform(post("/api/session/reauthentication").cookie(full).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\"" + code + ",\"credential\":"
                                + codec.encode(authenticator.assertion(options, ORIGIN)) + "}"))
                .andExpect(status().isNoContent()).andReturn();
        Cookie renewed = session(result);
        assertThat(renewed.getValue()).isNotEqualTo(full.getValue());
        mvc.perform(get("/api/session").cookie(renewed)).andExpect(jsonPath("$.authenticated").value(true));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(2);
        assertThat(jdbc.sql("SELECT count(*) FROM mfa_challenge WHERE account_id = :id AND purpose = 'REAUTHENTICATION'")
                .param("id", account).query(Integer.class).single()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"wrong-origin", "wrong-password", "both-proofs", "missing-challenge", "missing-password-hash"})
    void givenAnExpiredWebAuthnProof_whenARequiredProofIsInvalid_thenNeitherFreshnessNorTheKeyCounterChanges(
            String invalidProof) throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        expire(sessions, full);
        String json = mvc.perform(post("/api/account/mfa/webauthn/authentication-options").cookie(full).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var options = codec.decode(json, PublicKeyCredentialRequestOptions.class);
        String origin = invalidProof.equals("wrong-origin") ? "https://foreign.example.org" : ORIGIN;
        String password = invalidProof.equals("wrong-password") ? "wrong-password" : "correct-horse";
        String code = invalidProof.equals("both-proofs") ? ",\"code\":\"123456\"" : "";
        if (invalidProof.equals("missing-challenge")) {
            jdbc.sql("DELETE FROM mfa_challenge WHERE account_id = :id AND purpose = 'REAUTHENTICATION'")
                    .param("id", account).update();
        }
        if (invalidProof.equals("missing-password-hash")) {
            jdbc.sql("UPDATE user_account SET password_hash = NULL WHERE id = :id").param("id", account).update();
        }

        // when / then
        mvc.perform(post("/api/session/reauthentication").cookie(full).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"" + password + "\"" + code + ",\"credential\":"
                                + codec.encode(authenticator.assertion(options, origin)) + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
        String id = new String(Base64.getDecoder().decode(full.getValue()), StandardCharsets.UTF_8);
        assertThat(sessions.findById(id)).isNotNull();
        assertThat(sessions.findById(id).<Long>getAttribute("courtside.authenticated-at"))
                .isEqualTo(clock.instant().minusSeconds(360).toEpochMilli());
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(1);
        if (invalidProof.equals("wrong-password") || invalidProof.equals("both-proofs")
                || invalidProof.equals("missing-password-hash")) {
            assertThat(jdbc.sql("SELECT attempt_count FROM mfa_challenge WHERE account_id = :id AND purpose = 'REAUTHENTICATION'")
                    .param("id", account).query(Integer.class).single()).isZero();
        }
    }

    @Test
    void givenAnUnknownCredential_whenTheHolderRemovesIt_thenTheResponseNamesAnAbsentResource() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        // when / then
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/account/mfa/webauthn/credentials/{id}", "dW5rbm93bg").cookie(full).with(csrf()))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-resource-not-found"));
        assertThat(credentials.enabled(account)).isTrue();
    }

    @Test
    void givenAnAccountAtTheCredentialLimit_whenTheHolderBeginsAnotherRegistration_thenTheLimitIsNamed() throws Exception {
        // given
        var authenticator = enroll();
        for (int index = 2; index <= MfaWebAuthn.CREDENTIAL_LIMIT; index++) {
            var options = codec.decode(codec.encode(webAuthn.registrationOptions(account)), PublicKeyCredentialCreationOptions.class);
            assertThat(webAuthn.register(account, options, new WebAuthnAuthenticatorFixture().register(options, ORIGIN), "Key " + index))
                    .as("credential %s is within the limit", index).isTrue();
        }
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        // when / then
        mvc.perform(post("/api/account/mfa/webauthn/registration-options").cookie(full).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:webauthn-credential-limit-reached"))
                .andExpect(jsonPath("$.violations[0].code").value("identity.mfa.webauthnLimitReached"))
                .andExpect(jsonPath("$.violations[0].params.limit").value(MfaWebAuthn.CREDENTIAL_LIMIT));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void givenAnEnrolledSecurityKey_whenRemovingTheLastKey_thenOnlyAnExistingTotpKeepsMfaAndRecoveryCodesActive(
            boolean keepTotp) throws Exception {
        // given
        var authenticator = enroll();
        if (keepTotp) {
            byte[] secret = totp.begin(account);
            assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        }
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        // when
        List<String> actions = credentialActions(() -> mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/account/mfa/webauthn/credentials/{id}", authenticator.credentialId().toBase64UrlString())
                        .cookie(full).with(csrf())).andExpect(status().isNoContent()));
        // then
        assertThat(actions).as("only removing the last factor is recorded as disabling MFA")
                .containsExactly(keepTotp ? "MFA_METHOD_CHANGED" : "MFA_DISABLED");
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNull();
        assertThat(totp.enabled(account)).isEqualTo(keepTotp);
        assertThat(jdbc.sql("SELECT count(*) FROM mfa_recovery_code WHERE account_id = :id")
                .param("id", account).query(Integer.class).single()).isEqualTo(keepTotp ? 10 : 0);
        mvc.perform(get("/api/session").cookie(full)).andExpect(jsonPath("$.authenticated").value(false));
        password(keepTotp ? 202 : 200);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void givenATrustedWebAuthnOrigin_whenTotpOrAKeyProtectsTheAccount_thenSessionCapabilitiesNameOnlyEnrolledFactors(
            boolean useKey) throws Exception {
        // given
        Cookie plain = password(200);
        mvc.perform(get("/api/session").cookie(plain)).andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.mfaRequired").value(false)).andExpect(jsonPath("$.webauthnAvailable").value(false));
        WebAuthnAuthenticatorFixture authenticator = null;
        byte[] secret = null;
        if (useKey) authenticator = enroll();
        else {
            secret = totp.begin(account);
            assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        }

        // when
        Cookie pending = password(202);
        mvc.perform(get("/api/session").cookie(pending)).andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.mfaRequired").value(true)).andExpect(jsonPath("$.username").doesNotExist())
                .andExpect(jsonPath("$.totpAvailable").value(!useKey)).andExpect(jsonPath("$.webauthnAvailable").value(useKey));
        Cookie full;
        if (useKey) full = prove(pending, authenticator, options(pending));
        else full = session(mvc.perform(post("/api/session/mfa").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}"))
                .andExpect(status().isOk()).andReturn());

        // then
        mvc.perform(get("/api/session").cookie(full)).andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.mfaRequired").value(false)).andExpect(jsonPath("$.mfaEnabled").value(true))
                .andExpect(jsonPath("$.totpAvailable").value(!useKey)).andExpect(jsonPath("$.webauthnAvailable").value(useKey));
    }

    @Test
    void givenAnExpiredRegistrationChallenge_whenTheKeyIsSubmitted_thenNoCredentialOrRecoveryCodeIsCreated() throws Exception {
        // given
        Cookie session = password(200);
        var options = registrationOptions(session);
        jdbc.sql("UPDATE mfa_challenge SET expires_at = :now WHERE account_id = :id AND purpose = 'WEBAUTHN_REGISTRATION'")
                .param("now", clock.instant().atOffset(ZoneOffset.UTC)).param("id", account).update();
        var authenticator = new WebAuthnAuthenticatorFixture();
        // when / then
        mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(enrollment(authenticator.register(options, ORIGIN))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNull();
        assertThat(recovery.remaining(account)).isZero();
    }

    @Test
    void givenAKeyAttestingAForeignOrigin_whenRegistering_thenItIsRefusedAndTheSameChallengeStillAcceptsTheRealOrigin()
            throws Exception {
        // given
        Cookie session = password(200);
        var options = registrationOptions(session);
        var authenticator = new WebAuthnAuthenticatorFixture();
        // when
        mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(enrollment(authenticator.register(options, "https://foreign.example.org"))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        // then
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNull();
        assertThat(recovery.remaining(account)).isZero();
        mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(enrollment(authenticator.register(options, ORIGIN))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.codes.length()").value(10));
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNotNull();
    }

    @Test
    void givenTheEnrollmentBudgetSpentOnMistypedTotpCodes_whenAKeyIsRegistered_thenTheSharedLimitRefusesIt() throws Exception {
        // given
        Cookie session = password(200);
        mvc.perform(post("/api/account/mfa/totp").cookie(session).with(csrf())).andExpect(status().isOk());
        for (int attempt = 1; attempt <= 20; attempt++) {
            mvc.perform(post("/api/account/mfa/totp/confirmation").cookie(session).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"invalid\"}"))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        }
        var options = registrationOptions(session);
        var authenticator = new WebAuthnAuthenticatorFixture();
        // when / then
        mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(enrollment(authenticator.register(options, ORIGIN))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:password-verification-rate-limited"));
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNull();
        assertThat(recovery.remaining(account)).isZero();
    }

    @Test
    void givenNoReauthenticationOptionsInTheSession_whenAKeyAssertionIsSent_thenFreshnessAndTheKeyCounterStayUnchanged()
            throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        expire(sessions, full);
        var unbound = codec.decode(codec.encode(webAuthn.authenticationOptions(account)), PublicKeyCredentialRequestOptions.class);
        // when / then
        mvc.perform(post("/api/session/reauthentication").cookie(full).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\",\"credential\":"
                                + codec.encode(authenticator.assertion(unbound, ORIGIN)) + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
        String id = new String(Base64.getDecoder().decode(full.getValue()), StandardCharsets.UTF_8);
        assertThat(sessions.findById(id).<Long>getAttribute("courtside.authenticated-at"))
                .isEqualTo(clock.instant().minusSeconds(360).toEpochMilli());
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(1);
    }

    @ParameterizedTest
    @MethodSource("unusableLabels")
    void givenAnUnusableLabel_whenTheServiceRenamesAKey_thenItRefusesAndTheKeyKeepsItsLabel(String label) throws Exception {
        // given
        var authenticator = enroll();
        String id = authenticator.credentialId().toBase64UrlString();
        // when / then
        asHolder(() -> assertThatThrownBy(() -> flow.rename(id, label)).isInstanceOf(MfaProofFailedException.class));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getLabel()).isEqualTo("Private security key");
    }

    @Test
    void givenAnotherMembersKey_whenAHolderRenamesOrRemovesIt_thenTheKeyIsAbsentForThemAndUntouched() throws Exception {
        // given
        var authenticator = enroll();
        Person john = people.save(new Person("John", "Roe", "john.roe@example.org"));
        UserAccount other = new UserAccount(john, "roe.john", passwords.encode("another-horse"), Set.of(Role.MEMBER), "en");
        other.enable();
        accounts.save(other);
        Cookie intruder = password("roe.john", "another-horse", 200);
        String id = authenticator.credentialId().toBase64UrlString();
        // when / then
        mvc.perform(patch("/api/account/mfa/webauthn/credentials/{id}", id).cookie(intruder).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"label\":\"Borrowed key\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-resource-not-found"));
        mvc.perform(delete("/api/account/mfa/webauthn/credentials/{id}", id).cookie(intruder).with(csrf()))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-resource-not-found"));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getLabel()).isEqualTo("Private security key");
        mvc.perform(get("/api/session").cookie(intruder)).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenAKeyAndTotp_whenTheHolderRemovesTotp_thenTheKeyKeepsMfaAndTheRecoveryCodesActive() throws Exception {
        // given
        var authenticator = enroll();
        byte[] secret = totp.begin(account);
        assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        // when
        List<String> actions = credentialActions(() -> mvc.perform(delete("/api/account/mfa/totp").cookie(full).with(csrf()))
                .andExpect(status().isNoContent()));
        // then
        assertThat(actions).as("a remaining key turns the removal into a method change").containsExactly("MFA_METHOD_CHANGED");
        assertThat(totp.enabled(account)).isFalse();
        assertThat(recovery.remaining(account)).isEqualTo(10);
        mvc.perform(get("/api/session").cookie(full)).andExpect(jsonPath("$.authenticated").value(false));
        password(202);
    }

    @Test
    void givenAnEnrolledKey_whenTotpIsConfirmedAsASecondFactor_thenTheExistingRecoveryCodesStayAndNoNewOnesAreShown()
            throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        Cookie full = prove(pending, authenticator, options(pending));
        String body = mvc.perform(post("/api/account/mfa/totp").cookie(full).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        byte[] secret = Base32.decode(codec.decode(body, ApiTotpEnrollment.class).getSecret());
        List<String> held = recoveryCodeHashes();
        // when
        List<String> actions = credentialActions(() -> mvc.perform(post("/api/account/mfa/totp/confirmation").cookie(full)
                        .with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant().minusSeconds(30)) + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.codes").isEmpty()));
        // then
        assertThat(actions).as("a second factor is a method change, not enabling MFA").containsExactly("MFA_METHOD_CHANGED");
        assertThat(totp.enabled(account)).isTrue();
        assertThat(recoveryCodeHashes()).hasSize(10).isEqualTo(held);
    }

    @Test
    void givenARevokedPendingLogin_whenKeyOptionsAreRequested_thenNoKeyChallengeIsBound() throws Exception {
        // given
        enroll();
        Cookie pending = password(202);
        jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id").param("id", account).update();
        // when / then
        mvc.perform(post("/api/session/mfa/webauthn/options").cookie(pending).with(csrf()))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        assertThat(jdbc.sql("SELECT payload FROM mfa_challenge WHERE account_id = :id AND purpose = 'LOGIN'")
                .param("id", account).query(String.class).single()).isEmpty();
    }

    @Test
    void givenAPendingLoginThatNeverRequestedKeyOptions_whenAnAssertionArrives_thenTheKeyIsNotConsulted() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        var unbound = codec.decode(codec.encode(webAuthn.authenticationOptions(account)), PublicKeyCredentialRequestOptions.class);
        // when
        List<String> reasons = securityEventValues("event.reason", () -> mvc.perform(post("/api/session/mfa/webauthn")
                        .cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(unbound, ORIGIN))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed")));
        // then
        assertThat(reasons).as("a key proof against a challenge without options is audited").containsExactly("MFA_PROOF_FAILED");
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
        mvc.perform(get("/api/session").cookie(pending)).andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenAPendingLogin_whenTheKeyAssertsAForeignOrigin_thenSignInFailsAndCountsAsASecondFactorFailure() throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        var options = options(pending);
        // when / then
        mvc.perform(post("/api/session/mfa/webauthn").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, "https://foreign.example.org"))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        mvc.perform(get("/api/session").cookie(pending)).andExpect(jsonPath("$.authenticated").value(false));
        assertThat(jdbc.sql("SELECT attempt_count FROM login_attempt_limit WHERE scope = 'FACTOR'").query(Integer.class).single())
                .as("a refused key proof is a second-factor failure").isEqualTo(1);
    }

    @Test
    void givenAnExhaustedSecondFactorBudget_whenAValidKeyAssertionArrives_thenSignInIsRateLimitedAndTheCounterStays()
            throws Exception {
        // given
        var authenticator = enroll();
        Cookie pending = password(202);
        var options = options(pending);
        for (int attempt = 1; attempt <= 5; attempt++) attempts.registerFactorFailure(account);
        // when / then
        mvc.perform(post("/api/session/mfa/webauthn").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, ORIGIN))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:second-factor-rate-limited"))
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(jsonPath("$.violations[0].code").value("identity.mfa.rateLimited"))
                .andExpect(jsonPath("$.violations[0].params.minutes").value(1));
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
        mvc.perform(get("/api/session").cookie(pending)).andExpect(jsonPath("$.authenticated").value(false));
    }

    private static Stream<Arguments> unusableLabels() {
        return Stream.of(Arguments.of((Object) null), Arguments.of("   "), Arguments.of("k".repeat(101)),
                Arguments.of("Key\u0007one"));
    }

    private List<String> recoveryCodeHashes() {
        return jdbc.sql("SELECT code_hash FROM mfa_recovery_code WHERE account_id = :id ORDER BY code_hash")
                .param("id", account).query(String.class).list();
    }

    private void asHolder(Runnable action) {
        long epoch = jdbc.sql("SELECT security_epoch FROM user_account WHERE id = :id").param("id", account)
                .query(Long.class).single();
        var principal = new CourtsideUserDetails(account, "doe.jane", "unused", true, true, List.of("ROLE_MEMBER"), epoch);
        var security = SecurityContextHolder.createEmptyContext();
        security.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession().setAttribute("courtside.authenticated-at", clock.instant().toEpochMilli());
        var previous = RequestContextHolder.getRequestAttributes();
        SecurityContextHolder.setContext(security);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        try {
            action.run();
        } finally {
            SecurityContextHolder.clearContext();
            RequestContextHolder.setRequestAttributes(previous);
        }
    }

    private PublicKeyCredentialCreationOptions registrationOptions(Cookie session) throws Exception {
        String json = mvc.perform(post("/api/account/mfa/webauthn/registration-options").cookie(session).with(csrf())
                        .header("Host", "untrusted.example.org"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.rp.id").value("courts.example.org"))
                .andExpect(jsonPath("$.authenticatorSelection.userVerification").value("required"))
                .andReturn().getResponse().getContentAsString();
        return codec.decode(json, PublicKeyCredentialCreationOptions.class);
    }

    private String enrollment(Object credential) {
        return "{\"label\":\"Private security key\",\"credential\":" + codec.encode(credential) + "}";
    }

    private WebAuthnAuthenticatorFixture enroll() throws Exception {
        Cookie session = password(200);
        var options = registrationOptions(session);
        var authenticator = new WebAuthnAuthenticatorFixture();
        String codes = mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(enrollment(authenticator.register(options, ORIGIN))))
                .andExpect(result -> assertThat(result.getResponse().getStatus())
                        .withFailMessage("Registration failed: %s", result.getResponse().getContentAsString()).isEqualTo(200))
                .andReturn().getResponse().getContentAsString();
        assertThat(codec.decode(codes, ApiMfaRecoveryCodeSet.class).getCodes()).hasSize(10);
        mvc.perform(get("/api/session").cookie(session)).andExpect(jsonPath("$.authenticated").value(false));
        return authenticator;
    }

    private PublicKeyCredentialRequestOptions options(Cookie pending) throws Exception {
        String json = mvc.perform(post("/api/session/mfa/webauthn/options").cookie(pending).with(csrf())
                        .header("Host", "untrusted.example.org"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.rpId").value("courts.example.org"))
                .andExpect(jsonPath("$.userVerification").value("required"))
                .andReturn().getResponse().getContentAsString();
        return codec.decode(json, PublicKeyCredentialRequestOptions.class);
    }

    private Cookie prove(Cookie pending, WebAuthnAuthenticatorFixture authenticator, PublicKeyCredentialRequestOptions options) throws Exception {
        return session(mvc.perform(post("/api/session/mfa/webauthn").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, ORIGIN))))
                .andExpect(status().isOk()).andReturn());
    }

    private Cookie password(int expected) throws Exception {
        return password("doe.jane", "correct-horse", expected);
    }

    private Cookie password(String username, String password, int expected) throws Exception {
        return session(mvc.perform(post("/api/session").with(csrf()).param("username", username).param("password", password))
                .andExpect(status().is(expected)).andReturn());
    }

    private Cookie session(MvcResult result) {
        Cookie cookie = result.getResponse().getCookie("SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }

    private <S extends Session> void expire(SessionRepository<S> repository, Cookie cookie) {
        String id = new String(Base64.getDecoder().decode(cookie.getValue()), StandardCharsets.UTF_8);
        S session = repository.findById(id);
        assertThat(session).isNotNull();
        session.setAttribute("courtside.authenticated-at", clock.instant().minusSeconds(360).toEpochMilli());
        repository.save(session);
    }

    private static List<String> credentialActions(ThrowingRunnable action) throws Exception {
        return securityEventValues("event.action", action);
    }

    private static List<String> securityEventValues(String key, ThrowingRunnable action) throws Exception {
        Logger log = (Logger) LoggerFactory.getLogger("org.courtside.security.events");
        ListAppender<ILoggingEvent> recorded = new ListAppender<>();
        recorded.start();
        log.addAppender(recorded);
        try {
            action.run();
        } finally {
            log.detachAppender(recorded);
        }
        return recorded.list.stream().flatMap(event -> event.getKeyValuePairs() == null ? java.util.stream.Stream.empty()
                        : event.getKeyValuePairs().stream())
                .filter(pair -> pair.key.equals(key)).map(pair -> String.valueOf(pair.value)).toList();
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
