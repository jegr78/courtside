package org.courtside.identity.internal;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import java.util.List;
import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.courtside.api.ApiMfaRecoveryCodeSet;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
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

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
        // when / then
        mvc.perform(post("/api/session/mfa/webauthn").cookie(pending).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(codec.encode(authenticator.assertion(options, ORIGIN))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
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

    private WebAuthnAuthenticatorFixture enroll() throws Exception {
        Cookie session = password(200);
        String json = mvc.perform(post("/api/account/mfa/webauthn/registration-options").cookie(session).with(csrf())
                        .header("Host", "untrusted.example.org"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.rp.id").value("courts.example.org"))
                .andExpect(jsonPath("$.authenticatorSelection.userVerification").value("required"))
                .andReturn().getResponse().getContentAsString();
        var options = codec.decode(json, PublicKeyCredentialCreationOptions.class);
        var authenticator = new WebAuthnAuthenticatorFixture();
        String codes = mvc.perform(post("/api/account/mfa/webauthn").cookie(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"Private security key\",\"credential\":" + codec.encode(authenticator.register(options, ORIGIN)) + "}"))
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
        return session(mvc.perform(post("/api/session").with(csrf()).param("username", "doe.jane").param("password", "correct-horse"))
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
                .filter(pair -> pair.key.equals("event.action")).map(pair -> String.valueOf(pair.value)).toList();
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
