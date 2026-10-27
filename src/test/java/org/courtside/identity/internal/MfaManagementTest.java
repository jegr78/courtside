package org.courtside.identity.internal;

import org.bouncycastle.util.encoders.Base32;
import org.courtside.AbstractIntegrationTest;
import org.courtside.api.ApiMfaRecoveryCodeSet;
import org.courtside.api.ApiTotpEnrollment;
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
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.Set;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MfaManagementTest extends AbstractIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaRecoveryCodeRepository recovery;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    @Autowired private ObjectMapper json;
    @Autowired private MfaManagement management;
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
    void givenFreshPasswordProof_whenEnrollingAndConfirmingTotp_thenCodesAreShownOnceAndOldSessionsAreRevoked() throws Exception {
        // given
        MockHttpSession session = signIn(200);
        mvc.perform(get("/api/account/mfa").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false)).andExpect(jsonPath("$.recoveryCodesRemaining").value(0));
        // when
        ApiTotpEnrollment setup = setup(session);
        byte[] secret = Base32.decode(setup.getSecret());
        // then
        assertThat(setup.getUri().toString()).startsWith("otpauth://totp/")
                .contains("secret=" + setup.getSecret(), "digits=6", "period=30");
        mvc.perform(get("/api/account/mfa").session(session)).andExpect(jsonPath("$.enabled").value(false));
        // when
        String body = mvc.perform(post("/api/account/mfa/totp/confirmation").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant().minusSeconds(30)) + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        ApiMfaRecoveryCodeSet codes = json.readValue(body, ApiMfaRecoveryCodeSet.class);
        // then
        assertThat(codes.getCodes()).hasSize(10);
        assertThat(recovery.remaining(account)).isEqualTo(10);
        assertThat(jdbc.sql("SELECT count(*) FROM notification WHERE account_id = :id AND kind = 'ACCOUNT_SECURITY_CHANGED'")
                .param("id", account).query(Integer.class).single()).isEqualTo(1);
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.authenticated").value(false));
        MockHttpSession pending = signIn(202);
        MockHttpSession full = (MockHttpSession) mvc.perform(post("/api/session/mfa").session(pending).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + codes.getCodes().getFirst() + "\"}"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
        mvc.perform(get("/api/account/mfa").session(full)).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.totpEnabled").value(true)).andExpect(jsonPath("$.recoveryCodesRemaining").value(9))
                .andExpect(jsonPath("$.codes").doesNotExist()).andExpect(jsonPath("$.secret").doesNotExist());
    }

    @Test
    void givenExpiredPasswordProof_whenStartingEnrollment_thenNoSetupSecretIsCreated() throws Exception {
        // given
        MockHttpSession session = signIn(200);
        session.setAttribute("courtside.authenticated-at", clock.instant().minusSeconds(360).toEpochMilli());
        // when / then
        mvc.perform(post("/api/account/mfa/totp").session(session).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(jdbc.sql("SELECT count(*) FROM account_mfa WHERE account_id = :id")
                .param("id", account).query(Integer.class).single()).isZero();
    }

    @Test
    void givenPendingSetup_whenAnInvalidCodeIsConfirmed_thenMfaAndRecoveryCodesRemainDisabled() throws Exception {
        // given
        MockHttpSession session = signIn(200);
        setup(session);
        // when / then
        mvc.perform(post("/api/account/mfa/totp/confirmation").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"invalid\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        mvc.perform(get("/api/account/mfa").session(session)).andExpect(jsonPath("$.enabled").value(false));
        assertThat(recovery.remaining(account)).isZero();
    }

    @Test
    void givenActiveMfaAndFreshFullProof_whenReplacingRecoveryCodes_thenThePreviousSetAndSessionAreInvalid() throws Exception {
        // given
        List<String> previous = activate();
        MockHttpSession session = complete(previous.getFirst());
        // when
        String body = mvc.perform(post("/api/account/mfa/recovery-codes").session(session).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<String> replacement = json.readValue(body, ApiMfaRecoveryCodeSet.class).getCodes();
        // then
        assertThat(replacement).hasSize(10).doesNotContainAnyElementsOf(previous);
        assertThat(recovery.consume(account, previous.get(1))).isFalse();
        assertThat(recovery.remaining(account)).isEqualTo(10);
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.authenticated").value(false));
        mvc.perform(get("/api/session").session(complete(replacement.getFirst())))
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenActiveMfaAndExpiredProof_whenReplacingCodes_thenTheOriginalCodesRemainValid() throws Exception {
        // given
        List<String> previous = activate();
        MockHttpSession session = complete(previous.getFirst());
        session.setAttribute("courtside.authenticated-at", clock.instant().minusSeconds(360).toEpochMilli());
        // when / then
        mvc.perform(post("/api/account/mfa/recovery-codes").session(session).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(recovery.remaining(account)).isEqualTo(9);
        assertThat(recovery.consume(account, previous.get(1))).isTrue();
    }

    @Test
    void givenActiveMfaAndFreshFullProof_whenDisablingMfa_thenPasswordLoginWorksAndRecoveryCodesAreRemoved() throws Exception {
        // given
        List<String> previous = activate();
        MockHttpSession session = complete(previous.getFirst());
        // when
        mvc.perform(delete("/api/account/mfa").session(session).with(csrf())).andExpect(status().isNoContent());
        // then
        assertThat(recovery.remaining(account)).isZero();
        mvc.perform(get("/api/session").session(session)).andExpect(jsonPath("$.authenticated").value(false));
        mvc.perform(get("/api/account/mfa").session(signIn(200))).andExpect(jsonPath("$.enabled").value(false));
    }

    private List<String> activate() throws Exception {
        MockHttpSession session = signIn(200);
        byte[] secret = Base32.decode(setup(session).getSecret());
        String body = mvc.perform(post("/api/account/mfa/totp/confirmation").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + TotpCodes.code(secret, clock.instant().minusSeconds(30)) + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readValue(body, ApiMfaRecoveryCodeSet.class).getCodes();
    }

    @Test
    void givenAReusedPrincipalName_whenTheLockedAccountHasAnotherIdentity_thenItCannotReceiveTheFirstHoldersSetup() {
        // given
        Person john = people.save(new Person("John", "Roe", "john.roe@example.org"));
        UserAccount other = new UserAccount(john, "roe.john", passwords.encode("another-password"), Set.of(Role.MEMBER), "en");
        other.enable();
        accounts.save(other);
        var principal = new CourtsideUserDetails(account, other.getUsername(), "unused", true, true,
                List.of("ROLE_MEMBER"), 0);
        var security = SecurityContextHolder.createEmptyContext();
        security.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession().setAttribute("courtside.authenticated-at", clock.instant().toEpochMilli());
        var previous = RequestContextHolder.getRequestAttributes();
        SecurityContextHolder.setContext(security);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        // when / then
        try {
            assertThatThrownBy(management::beginTotp).isInstanceOf(MfaProofFailedException.class);
            assertThat(jdbc.sql("SELECT count(*) FROM account_mfa WHERE account_id = :id")
                    .param("id", other.getId()).query(Integer.class).single()).isZero();
        } finally {
            SecurityContextHolder.clearContext();
            RequestContextHolder.setRequestAttributes(previous);
        }
    }

    private MockHttpSession complete(String code) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/session/mfa").session(signIn(202)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private ApiTotpEnrollment setup(MockHttpSession session) throws Exception {
        String body = mvc.perform(post("/api/account/mfa/totp").session(session).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readValue(body, ApiTotpEnrollment.class);
    }

    private MockHttpSession signIn(int expected) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/session").with(csrf())
                        .param("username", "doe.jane").param("password", "correct-horse"))
                .andExpect(status().is(expected)).andReturn().getRequest().getSession(false);
    }
}
