package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {
        "courtside.login-protection.verification-concurrency=1",
        "courtside.login-protection.address.max-failures=2",
        "courtside.login-protection.global.threshold=20"
})
class LastSignInTest extends AbstractIntegrationTest {

    private static final Instant EARLIER_SIGN_IN = Instant.parse("2026-04-01T08:30:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;

    private UUID janeId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        janeId = accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.MEMBER), "de")))
                .getId();
    }

    @Test
    void givenAnAccountThatNeverSignedIn_whenItSignsIn_thenTheSignInInstantIsRecorded() throws Exception {
        // given
        long versionBefore = version();

        // when
        mockMvc.perform(signIn("correct-horse", "192.0.2.70")).andExpect(status().isOk());

        // then
        assertThat(lastSignIn()).as("last_login_at after a successful sign-in").isEqualTo(clock.instant());
        assertThat(version()).as("a sign-in must not conflict with a concurrent account edit")
                .isEqualTo(versionBefore);
    }

    @Test
    void givenAnEarlierSignIn_whenItSignsInAgain_thenOnlyTheLatestInstantIsKept() throws Exception {
        // given
        recordEarlierSignIn();

        // when
        mockMvc.perform(signIn("correct-horse", "192.0.2.71")).andExpect(status().isOk());

        // then
        assertThat(lastSignIn()).as("last_login_at after a repeated sign-in").isEqualTo(clock.instant());
    }

    @Test
    void givenAnEarlierSignIn_whenTheWrongPasswordIsGiven_thenTheRecordedInstantStays() throws Exception {
        // given
        recordEarlierSignIn();

        // when
        mockMvc.perform(signIn("wrong", "192.0.2.72"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));

        // then
        assertThat(lastSignIn()).as("last_login_at after a failed sign-in").isEqualTo(EARLIER_SIGN_IN);
    }

    @Test
    void givenAnEarlierSignIn_whenARateLimitedAttemptGivesTheRightPassword_thenTheRecordedInstantStays()
            throws Exception {
        // given
        recordEarlierSignIn();
        mockMvc.perform(signIn("wrong", "192.0.2.73")).andExpect(status().isUnauthorized());
        mockMvc.perform(signIn("wrong", "192.0.2.73")).andExpect(status().isUnauthorized());

        // when
        mockMvc.perform(signIn("correct-horse", "192.0.2.73"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:login-rate-limited"));

        // then
        assertThat(lastSignIn()).as("last_login_at after a rate-limited sign-in").isEqualTo(EARLIER_SIGN_IN);
    }

    @Test
    void givenADisabledAccountWithAnEarlierSignIn_whenTheRightPasswordIsGiven_thenTheRecordedInstantStays()
            throws Exception {
        // given
        recordEarlierSignIn();
        jdbc.sql("UPDATE user_account SET enabled = false WHERE id = :id").param("id", janeId).update();

        // when
        mockMvc.perform(signIn("correct-horse", "192.0.2.74")).andExpect(status().isUnauthorized());

        // then
        assertThat(lastSignIn()).as("last_login_at after a refused sign-in").isEqualTo(EARLIER_SIGN_IN);
    }

    private MockHttpServletRequestBuilder signIn(String password, String address) {
        return post("/api/session")
                .param("username", "doe.jane")
                .param("password", password)
                .with(request -> {
                    request.setRemoteAddr(address);
                    return request;
                })
                .with(csrf());
    }

    private void recordEarlierSignIn() {
        jdbc.sql("UPDATE user_account SET last_login_at = :at WHERE id = :id")
                .param("at", Timestamp.from(EARLIER_SIGN_IN))
                .param("id", janeId)
                .update();
    }

    private Instant lastSignIn() {
        Timestamp stored = jdbc.sql("SELECT last_login_at FROM user_account WHERE id = :id")
                .param("id", janeId)
                .query(Timestamp.class)
                .list()
                .getFirst();
        return stored == null ? null : stored.toInstant();
    }

    private long version() {
        return jdbc.sql("SELECT version FROM user_account WHERE id = :id")
                .param("id", janeId)
                .query(Long.class)
                .single();
    }
}
