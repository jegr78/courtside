package org.courtside.identity.internal;

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
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
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

    @Test
    void givenAWebAuthnSessionWithExpiredProof_whenReauthenticating_thenPasswordAndTheKeyAreBothRequired() throws Exception {
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
        var result = mvc.perform(post("/api/session/reauthentication").cookie(full).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\",\"credential\":" + codec.encode(authenticator.assertion(options, ORIGIN)) + "}"))
                .andExpect(status().isNoContent()).andReturn();
        Cookie renewed = session(result);
        assertThat(renewed.getValue()).isNotEqualTo(full.getValue());
        mvc.perform(get("/api/session").cookie(renewed)).andExpect(jsonPath("$.authenticated").value(true));
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
}
