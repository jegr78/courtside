package org.courtside.identity;

import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PermanentPasswordChangeRollbackTest extends AbstractIntegrationTest {

    private static final String CURRENT = "correct-horse-battery";
    private static final String REPLACEMENT = "lattice-scaffold-marmoset-vellum";

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder encoder;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @MockitoSpyBean private JdbcIndexedSessionRepository sessions;
    @MockitoSpyBean private SecurityEventLog securityEvents;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions).apply(springSecurity()).build();
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(person, "doe.jane", encoder.encode(CURRENT),
                Set.of(Role.MEMBER), "en")));
    }

    @Test
    void givenTheStoreRefusesSessionDeletion_whenThePasswordChanges_thenEpochRevocationStillEndsIt()
            throws Exception {
        // given
        Cookie session = signIn();
        UserAccount before = accounts.findByUsername("doe.jane").orElseThrow();
        doThrow(new IllegalStateException("session termination unavailable"))
                .when(sessions).findByPrincipalName("doe.jane");

        // when
        mockMvc.perform(put("/api/account/password").cookie(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"" + CURRENT
                                + "\",\"newPassword\":\"" + REPLACEMENT + "\"}"))
                .andExpect(status().isNoContent());

        // then
        UserAccount after = accounts.findByUsername("doe.jane").orElseThrow();
        assertThat(after.getSecurityEpoch()).isGreaterThan(before.getSecurityEpoch());
        assertThat(encoder.matches(REPLACEMENT, after.getPasswordHash())).isTrue();
        mockMvc.perform(get("/api/session").cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenTheTransactionFailsAfterRevocationIsScheduled_whenChangingPassword_thenNothingChanges()
            throws Exception {
        // given
        Cookie session = signIn();
        UserAccount before = accounts.findByUsername("doe.jane").orElseThrow();
        long epochBefore = before.getSecurityEpoch();
        doThrow(new IllegalStateException("event scheduling unavailable"))
                .when(securityEvents).credentialChangedAfterCommit(any(), any(),
                        eq(SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED));

        // when / then
        assertThatThrownBy(() -> mockMvc.perform(put("/api/account/password")
                        .cookie(session).with(csrf())
                        .contentType("application/json")
                        .content("{\"currentPassword\":\"" + CURRENT
                                + "\",\"newPassword\":\"" + REPLACEMENT + "\"}")))
                .hasRootCauseMessage("event scheduling unavailable");

        // then
        UserAccount after = accounts.findByUsername("doe.jane").orElseThrow();
        assertThat(after.getSecurityEpoch()).isEqualTo(epochBefore);
        assertThat(encoder.matches(CURRENT, after.getPasswordHash())).isTrue();
        mockMvc.perform(get("/api/session").cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    private Cookie signIn() throws Exception {
        Cookie cookie = mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", CURRENT).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }
}
