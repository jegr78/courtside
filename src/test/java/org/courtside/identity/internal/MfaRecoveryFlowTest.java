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
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MfaRecoveryFlowTest extends AbstractIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private MfaRecoveryCodeRepository codes;
    @Autowired private ControlledAccountRecovery recovery;
    @Autowired private JdbcClient jdbc;
    @Autowired private ObjectMapper json;
    private MockMvc mvc;
    private UUID admin;
    private UUID target;
    private List<String> adminCodes;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        admin = holder("doe.jane", "jane.doe@example.org", Role.ADMIN);
        target = holder("roe.john", "john.roe@example.org", Role.MEMBER);
        adminCodes = activate(admin);
        activate(target);
    }

    @Test
    void givenFreshMfaAdmin_whenRecoveringALostAccount_thenOnlyTheMailedCodeAndNewPasswordUnblockIt() throws Exception {
        // given
        MockHttpSession session = signIn("doe.jane", adminCodes.getFirst());
        // when
        mvc.perform(post("/api/admin/accounts/{id}/mfa-recovery", target).session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"identityChecked\":true}"))
                .andExpect(status().isAccepted());
        // then
        mvc.perform(get("/api/admin/accounts/{id}/mfa", target).session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.recoveryPending").value(true)).andExpect(jsonPath("$.devices").doesNotExist())
                .andExpect(jsonPath("$.secret").doesNotExist()).andExpect(jsonPath("$.codes").doesNotExist());
        mvc.perform(post("/api/session").with(csrf()).param("username", "roe.john").param("password", "previous-password"))
                .andExpect(status().isUnauthorized());
        UUID id = jdbc.sql("SELECT recovery_id FROM account_mfa_recovery WHERE account_id = :id")
                .param("id", target).query(UUID.class).single();
        String code = recovery.issueFor(target, id).code();
        String body = json.writeValueAsString(java.util.Map.of("username", "roe.john", "code", code, "password", "another-unusual-password"));
        mvc.perform(post("/api/account-recovery/mfa/redemption").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/account-recovery/mfa/redemption").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.type").value("urn:courtside:error:account-recovery-code-invalid"));
        mvc.perform(post("/api/session").with(csrf()).param("username", "roe.john").param("password", "another-unusual-password"))
                .andExpect(status().isOk());
        assertThat(totp.enabled(target)).isFalse();
        assertThat(codes.remaining(target)).isZero();
    }

    @Test
    void givenFreshMfaAdmin_whenIdentityWasNotChecked_thenTheAccountAndFactorsRemainUsable() throws Exception {
        // given
        MockHttpSession session = signIn("doe.jane", adminCodes.getFirst());
        // when / then
        mvc.perform(post("/api/admin/accounts/{id}/mfa-recovery", target).session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"identityChecked\":false}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
        assertThat(jdbc.sql("SELECT recovery_pending FROM account_mfa WHERE account_id = :id")
                .param("id", target).query(Boolean.class).single()).isFalse();
    }

    @Test
    void givenAMember_whenReadingAnotherAccountsMfaStatus_thenThePrivateAccountRouteIsRefused() throws Exception {
        // given
        String code = codesFor(target);
        MockHttpSession session = signIn("roe.john", code);
        // when / then
        mvc.perform(get("/api/admin/accounts/{id}/mfa", admin).session(session))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenAnUnknownAccount_whenAnAdministratorReadsItsFactorState_thenTheResponseNamesAnAbsentResource() throws Exception {
        // given
        MockHttpSession session = signIn("doe.jane", adminCodes.getFirst());
        // when / then
        mvc.perform(get("/api/admin/accounts/{id}/mfa", UUID.randomUUID()).session(session))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-resource-not-found"));
    }

    private UUID holder(String username, String email, Role role) {
        UserAccount holder = new UserAccount(people.save(new Person("Jane", "Doe", email)), username,
                passwords.encode("previous-password"), Set.of(role), "en");
        holder.enable();
        return accounts.save(holder).getId();
    }

    private List<String> activate(UUID id) {
        totp.begin(id);
        jdbc.sql("UPDATE account_mfa SET totp_secret = pending_totp_secret, pending_totp_secret = NULL, pending_totp_expires_at = NULL WHERE account_id = :id")
                .param("id", id).update();
        List<String> values = MfaRecoveryCodes.generate();
        codes.replace(id, values);
        return values;
    }

    private String codesFor(UUID id) {
        List<String> values = MfaRecoveryCodes.generate();
        codes.replace(id, values);
        return values.getFirst();
    }

    private MockHttpSession signIn(String username, String code) throws Exception {
        var pending = (MockHttpSession) mvc.perform(post("/api/session").with(csrf()).param("username", username)
                        .param("password", "previous-password")).andExpect(status().isAccepted())
                .andReturn().getRequest().getSession(false);
        return (MockHttpSession) mvc.perform(post("/api/session/mfa").session(pending).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("code", code))))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }
}
