package org.courtside.identity;

import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class StoredSessionAgeTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private SessionRepositoryFilter<?> storedSessions;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private PersonRepository persons;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // Spring Session ahead of the security chain, as the running application orders them: without
        // it the session under test is the container's own and carries no stored creation time.
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions)
                .apply(springSecurity())
                .build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de")));
    }

    @Test
    void givenAStoredSessionAgedPastTheLifetime_whenItActs_thenTheStoredRowIsWhatEndsIt() throws Exception {
        // given — nothing in this process is changed, only the row a restart would leave behind
        Cookie session = signedIn();
        aged(session, 0L);

        // when / then
        mockMvc.perform(get("/api/admin/config").cookie(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenTheSameStoredSessionUnaged_whenItActs_thenItKeepsItsAuthority() throws Exception {
        // given
        Cookie session = signedIn();

        // when / then
        mockMvc.perform(get("/api/admin/config").cookie(session)).andExpect(status().isOk());
    }

    // A club laptop at the clubhouse desk is one browser for everybody who uses it, and whoever signs
    // in on a session that is still alive would otherwise get the lifetime it already spent.
    @Test
    void givenALivingSessionSignedInAgain_whenTheRowIsRead_thenTheLifetimeRunsFromTheSecondSignIn()
            throws Exception {
        // given — inside the lifetime, so the request is carried rather than ended before it arrives
        Cookie first = signedIn();
        aged(first, System.currentTimeMillis() - Duration.ofHours(23).toMillis());
        long beforeTheSecondSignIn = System.currentTimeMillis();

        // when
        Cookie second = signedIn(post("/api/session").cookie(first));

        // then
        assertThat(storedCreationTime(second))
                .as("the second member inherits what the first one already spent, so a shared browser"
                        + " signs them out an hour after they arrived")
                .isGreaterThanOrEqualTo(beforeTheSecondSignIn);
    }

    private long storedCreationTime(Cookie session) {
        return jdbc.sql("SELECT creation_time FROM spring_session WHERE session_id = :id")
                .param("id", storedId(session))
                .query(Long.class)
                .single();
    }

    private void aged(Cookie session, long created) {
        assertThat(jdbc.sql("UPDATE spring_session SET creation_time = :created WHERE session_id = :id")
                        .param("created", created)
                        .param("id", storedId(session))
                        .update())
                .as("no stored row carries this session, so ageing it proved nothing")
                .isOne();
    }

    private String storedId(Cookie session) {
        return new String(Base64.getDecoder().decode(session.getValue()), StandardCharsets.UTF_8);
    }

    private Cookie signedIn() throws Exception {
        return signedIn(post("/api/session"));
    }

    private Cookie signedIn(MockHttpServletRequestBuilder signIn) throws Exception {
        Cookie session = mockMvc.perform(signIn
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("SESSION");
        assertThat(session).as("the sign-in handed out no stored session to read back").isNotNull();
        return session;
    }
}
