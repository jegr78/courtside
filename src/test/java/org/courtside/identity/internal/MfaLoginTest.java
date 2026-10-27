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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.login-protection.address.max-failures=5")
class MfaLoginTest extends AbstractIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private MfaRecoveryCodeRepository recovery;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    private MockMvc mvc;
    private UUID account;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount holder = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"),
                Set.of(Role.MEMBER), "en");
        holder.enable();
        account = accounts.save(holder).getId();
    }

    @Test
    void givenEnabledMfa_whenOnlyThePasswordSucceeds_thenNoIdentityOrAccountAccessIsGranted() throws Exception {
        // given
        enroll();
        // when
        MockHttpSession session = pending();
        // then
        mvc.perform(get("/api/session").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false)).andExpect(jsonPath("$.mfaRequired").value(true))
                .andExpect(jsonPath("$.username").doesNotExist()).andExpect(jsonPath("$.roles").isEmpty());
        mvc.perform(get("/api/account/sessions").session(session)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        assertThat(jdbc.sql("SELECT last_login_at IS NULL FROM user_account WHERE id = :id").param("id", account)
                .query(Boolean.class).single()).isTrue();
    }

    @Test
    void givenAPendingLogin_whenTheSecondFactorSucceeds_thenAReplacementSessionHasAccountPrivileges() throws Exception {
        // given
        byte[] secret = enroll();
        MockHttpSession pending = pending();
        // when
        MockHttpSession full = (MockHttpSession) mvc.perform(post("/api/session/mfa").session(pending).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        // then
        assertThat(full.getId()).isNotEqualTo(pending.getId());
        mvc.perform(get("/api/session").session(full)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true)).andExpect(jsonPath("$.username").value("doe.jane"));
        mvc.perform(get("/api/account/sessions").session(full)).andExpect(status().isOk());
        assertThat(jdbc.sql("SELECT last_login_at FROM user_account WHERE id = :id").param("id", account)
                .query((rs, row) -> rs.getTimestamp(1).toInstant()).single()).isEqualTo(clock.instant());
    }

    @Test
    void givenARevokedPendingLogin_whenTheCodeIsCorrect_thenItStillCannotAuthenticate() throws Exception {
        // given
        byte[] secret = enroll();
        MockHttpSession session = pending();
        jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id").param("id", account).update();
        // when / then
        mvc.perform(post("/api/session/mfa").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenRecoveryCodes_whenOneCompletesLogin_thenItsReuseDoesNotAuthenticateAnotherSession() throws Exception {
        // given
        enroll();
        var codes = MfaRecoveryCodes.generate();
        recovery.replace(account, codes);
        MockHttpSession first = pending();
        // when / then
        mvc.perform(post("/api/session/mfa").session(first).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + codes.getFirst() + "\"}"))
                .andExpect(status().isOk());
        MockHttpSession second = pending();
        mvc.perform(post("/api/session/mfa").session(second).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + codes.getFirst() + "\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
    }

    @Test
    void givenNoMfaEnrollment_whenThePasswordSucceeds_thenTheExistingLoginStillWorks() throws Exception {
        // when
        MockHttpSession session = (MockHttpSession) mvc.perform(post("/api/session").with(csrf())
                        .param("username", "doe.jane").param("password", "correct-horse"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        // then
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenMfa_whenRestartingPasswordLoginAfterFailedCodes_thenTheAccountGuessBudgetStillApplies() throws Exception {
        // given
        byte[] secret = enroll();
        // when / then
        for (int attempt = 1; attempt <= 5; attempt++) {
            MockHttpSession session = pending();
            String address = "192.0.2." + attempt;
            mvc.perform(post("/api/session/mfa").session(session).with(csrf())
                            .with(request -> { request.setRemoteAddr(address); return request; })
                            .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"invalid\"}"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        }
        MockHttpSession session = pending();
        mvc.perform(post("/api/session/mfa").session(session).with(csrf())
                        .with(request -> { request.setRemoteAddr("192.0.2.20"); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:password-verification-rate-limited"));
    }

    @Test
    void givenAnMfaSessionWithExpiredProof_whenOnlyThePasswordIsRepeated_thenSensitiveProofIsNotRenewed() throws Exception {
        // given
        byte[] secret = enroll();
        MockHttpSession session = full(secret);
        long previous = clock.instant().minusSeconds(360).toEpochMilli();
        session.setAttribute("courtside.authenticated-at", previous);
        // when / then
        mvc.perform(post("/api/session/reauthentication").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"correct-horse\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
        assertThat(session.getAttribute("courtside.authenticated-at")).isEqualTo(previous);
    }

    @Test
    void givenAnMfaSession_whenPasswordAndAnotherTotpStepAreRepeated_thenFreshProofRenewsTheSession() throws Exception {
        // given
        byte[] secret = enroll();
        MockHttpSession session = full(secret);
        session.setAttribute("courtside.authenticated-at", clock.instant().minusSeconds(360).toEpochMilli());
        String code = TotpCodes.code(secret, clock.instant().plusSeconds(30));
        // when
        MockHttpSession renewed = (MockHttpSession) mvc.perform(post("/api/session/reauthentication")
                        .session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\",\"code\":\"" + code + "\"}"))
                .andExpect(status().isNoContent()).andReturn().getRequest().getSession(false);
        // then
        assertThat(renewed.getId()).isNotEqualTo(session.getId());
        assertThat(renewed.getAttribute("courtside.authenticated-at")).isEqualTo(clock.instant().toEpochMilli());
        mvc.perform(post("/api/session/reauthentication").session(renewed).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-horse\",\"code\":\"" + code + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
    }

    private MockHttpSession full(byte[] secret) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/session/mfa").session(pending()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private byte[] enroll() {
        byte[] secret = totp.begin(account);
        assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        return secret;
    }

    private MockHttpSession pending() throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/session").with(csrf())
                        .param("username", "doe.jane").param("password", "correct-horse"))
                .andExpect(status().isAccepted()).andReturn().getRequest().getSession(false);
    }
}
