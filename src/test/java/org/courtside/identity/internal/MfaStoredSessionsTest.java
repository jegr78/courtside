package org.courtside.identity.internal;

import jakarta.servlet.http.Cookie;
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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.session.concurrent-limit=2")
class MfaStoredSessionsTest extends AbstractIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private MfaRecoveryCodeRepository recovery;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    private MockMvc mvc;
    private List<String> codes;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(storedSessions).apply(springSecurity()).build();
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount holder = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"), Set.of(Role.MEMBER), "en");
        holder.enable();
        var account = accounts.save(holder).getId();
        byte[] secret = totp.begin(account);
        assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        codes = MfaRecoveryCodes.generate();
        recovery.replace(account, codes);
    }

    @Test
    void givenRepeatedPasswordProofs_whenCreatingMorePendingSessionsThanAllowed_thenTheOldestPendingSessionIsEnded() throws Exception {
        // given
        Cookie first = pending();
        pending();
        // when
        Cookie latest = pending();
        // then
        assertThat(jdbc.sql("SELECT count(*) FROM spring_session").query(Integer.class).single()).isEqualTo(2);
        mvc.perform(get("/api/session").cookie(first)).andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.mfaRequired").value(false));
        mvc.perform(get("/api/session").cookie(latest)).andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.mfaRequired").value(true));
    }

    @Test
    void givenCompletedMfaLogins_whenCreatingMoreFullSessionsThanAllowed_thenTheOldestFullSessionIsEnded() throws Exception {
        // given
        Cookie first = complete(codes.getFirst());
        complete(codes.get(1));
        // when
        Cookie latest = complete(codes.get(2));
        // then
        assertThat(jdbc.sql("SELECT count(*) FROM spring_session WHERE principal_name = 'doe.jane'")
                .query(Integer.class).single()).isEqualTo(2);
        mvc.perform(get("/api/session").cookie(first)).andExpect(jsonPath("$.authenticated").value(false));
        mvc.perform(get("/api/session").cookie(latest)).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenAPendingLogin_whenTheMfaProofHasNoCsrfToken_thenItsCodeAndChallengeRemainUnused() throws Exception {
        // given
        Cookie session = pending();
        // when / then
        mvc.perform(post("/api/session/mfa").cookie(session).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + codes.getFirst() + "\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(jdbc.sql("SELECT sum(attempt_count) FROM mfa_challenge").query(Integer.class).single()).isZero();
        complete(session, codes.getFirst());
    }

    private Cookie pending() throws Exception {
        Cookie cookie = mvc.perform(post("/api/session").with(csrf())
                        .param("username", "doe.jane").param("password", "correct-horse"))
                .andExpect(status().isAccepted()).andReturn().getResponse().getCookie("SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }

    private Cookie complete(String code) throws Exception {
        return complete(pending(), code);
    }

    private Cookie complete(Cookie pending, String code) throws Exception {
        Cookie cookie = mvc.perform(post("/api/session/mfa").cookie(pending).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + code + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }
}
