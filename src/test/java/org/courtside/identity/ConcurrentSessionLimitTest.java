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
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;

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
    private PersonRepository persons;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions)
                .apply(springSecurity())
                .build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de")));
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

        // when
        Cookie sixth = signedIn();

        // then
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
