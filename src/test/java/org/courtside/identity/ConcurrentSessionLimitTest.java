package org.courtside.identity;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ConcurrentSessionLimitTest extends AbstractIntegrationTest {

    private static final int PERMITTED = 5;

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private SessionRepositoryFilter<?> storedSessions;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private SqlStatementCounter statements;
    @Autowired
    private PersonRepository persons;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private final ListAppender<ILoggingEvent> recorded = new ListAppender<>();

    private MockMvc mockMvc;
    private UUID accountId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions)
                .apply(springSecurity())
                .build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accountId = accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de"))).getId();
        recorded.start();
        displacementLog().addAppender(recorded);
    }

    @AfterEach
    void tearDown() {
        displacementLog().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenTheAccountIsAtItsLimit_whenItSignsInOnceMore_thenTheLeastRecentlyActiveOneLosesAuthority()
            throws Exception {
        // given — five sessions, aged apart so that "least recently active" names exactly one of them
        List<Cookie> held = new ArrayList<>();
        for (int index = 0; index < PERMITTED; index++) {
            Cookie session = signedIn();
            lastActive(session, System.currentTimeMillis() - Duration.ofMinutes(20 - index).toMillis());
            held.add(session);
        }

        String displaced = storedId(held.getFirst());

        // when
        Cookie sixth = signedIn();

        // then — counted before any request carries the displaced cookie, because that request would
        // remove the row itself and a later count would say nothing about the displacement
        assertThat(rowsFor(displaced))
                .as("the ended session keeps no row, so the username, the roles and the epoch that"
                        + " cascade from it do not outlive the session they belonged to")
                .isZero();
        assertThat(recorded.list)
                .anySatisfy(event -> {
                    var fields = event.getKeyValuePairs().stream()
                            .collect(java.util.stream.Collectors.toMap(pair -> pair.key, pair -> pair.value));
                    assertThat(fields)
                            .containsEntry("event.code", "courtside.session.terminated")
                            .containsEntry("event.reason", "CONCURRENT_LIMIT")
                            .containsEntry("account.id", accountId.toString())
                            .containsEntry("actor.account.id", accountId.toString());
                    assertThat(event.toString()).doesNotContain("doe.jane", displaced);
                });
        mockMvc.perform(get("/api/admin/config").cookie(held.getFirst()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"))
                .andExpect(header().string("Content-Security-Policy",
                        org.hamcrest.Matchers.containsString("default-src 'self'")));
        for (Cookie kept : held.subList(1, held.size())) {
            mockMvc.perform(get("/api/admin/config").cookie(kept))
                    .andExpect(status().isOk());
        }
        mockMvc.perform(get("/api/admin/config").cookie(sixth)).andExpect(status().isOk());
    }

    @Test
    void givenTheAccountIsBelowItsLimit_whenEachSessionActs_thenEveryOneOfThemKeepsItsAuthority()
            throws Exception {
        // given — the counter-case: a bound that revoked eagerly would look identical above
        List<Cookie> held = new ArrayList<>();
        for (int index = 0; index < PERMITTED; index++) {
            held.add(signedIn());
        }

        // when / then
        for (Cookie session : held) {
            mockMvc.perform(get("/api/admin/config").cookie(session)).andExpect(status().isOk());
        }
        assertThat(storedRows()).isEqualTo(PERMITTED);
    }

    // Every other end in this application leaves the request without authority and lets it carry on,
    // so what needs none is answered rather than refused.
    @Test
    void givenADisplacedSession_whenItAsksWhoIsSignedIn_thenItIsToldNobodyIs() throws Exception {
        // given
        Cookie displaced = displacedByAFurtherSignIn();

        // when / then
        mockMvc.perform(get("/api/session").cookie(displaced))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenADisplacedSession_whenItSignsInAgainAsItsFirstRequest_thenThatSignInCarries()
            throws Exception {
        // given — the displaced browser has made no request since, so nothing has yet had the chance
        // to clear whatever the displacement left behind
        Cookie displaced = displacedByAFurtherSignIn();

        // when
        Cookie replacement = mockMvc.perform(post("/api/session")
                        .cookie(displaced)
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("SESSION");

        // then
        assertThat(replacement).isNotNull();
        mockMvc.perform(get("/api/admin/config").cookie(replacement)).andExpect(status().isOk());
    }

    private Cookie displacedByAFurtherSignIn() throws Exception {
        Cookie oldest = signedIn();
        lastActive(oldest, System.currentTimeMillis() - Duration.ofMinutes(25).toMillis());
        for (int index = 1; index < PERMITTED + 1; index++) {
            signedIn();
        }
        assertThat(rowsFor(storedId(oldest)))
                .as("the session this case needs displaced is still stored, so it was never displaced")
                .isZero();
        return oldest;
    }

    private long rowsFor(String sessionId) {
        return jdbc.sql("SELECT count(*) FROM spring_session WHERE session_id = :id")
                .param("id", sessionId).query(Long.class).single();
    }

    private static Logger displacementLog() {
        return (Logger) LoggerFactory.getLogger("org.courtside.security.events");
    }

    @Test
    void whenAnAuthenticatedRequestIsServed_thenTheBoundAddsNoStatementToIt() throws Exception {
        // given
        Cookie session = signedIn();
        mockMvc.perform(get("/api/admin/config").cookie(session)).andExpect(status().isOk());

        // when
        statements.reset();
        mockMvc.perform(get("/api/admin/config").cookie(session)).andExpect(status().isOk());

        // then — measured, not hoped: the same five that served the request before this bound existed
        assertThat(statements.snapshot().total())
                .as("the bound reads no session of its own per request; a rise here is that cost"
                        + " arriving where nobody looks")
                .isEqualTo(5);
    }

    private long storedRows() {
        return jdbc.sql("SELECT count(*) FROM spring_session WHERE principal_name = 'doe.jane'")
                .query(Long.class).single();
    }

    private void lastActive(Cookie session, long accessed) {
        assertThat(jdbc.sql("UPDATE spring_session SET last_access_time = :accessed WHERE session_id = :id")
                        .param("accessed", accessed)
                        .param("id", storedId(session))
                        .update())
                .as("no stored row carries this session, so its activity was never moved")
                .isOne();
    }

    private String storedId(Cookie session) {
        return new String(Base64.getDecoder().decode(session.getValue()), StandardCharsets.UTF_8);
    }

    private Cookie signedIn() throws Exception {
        Cookie session = mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("SESSION");
        assertThat(session).as("the sign-in handed out no stored session").isNotNull();
        return session;
    }
}
