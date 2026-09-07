package org.courtside.identity;

import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AdminSessionRevocationConcurrencyTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery";

    @Autowired private WebApplicationContext context;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @Autowired private FindByIndexNameSessionRepository<? extends Session> sessionRepository;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder encoder;

    private MockMvc mockMvc;
    private UUID targetPersonId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions).apply(springSecurity()).build();
        Person administrator = persons.save(new Person("Ada", "Admin", "ada@example.org"));
        accounts.save(enabled(new UserAccount(administrator, "admin", encoder.encode(PASSWORD),
                Set.of(Role.ADMIN), "en")));
        Person target = persons.save(new Person("Jane", "Doe", "jane@example.org"));
        targetPersonId = target.getId();
        accounts.save(enabled(new UserAccount(target, "member", encoder.encode(PASSWORD),
                Set.of(Role.MEMBER), "en")));
    }

    @Test
    void givenATargetRequestIsInFlight_whenAnAdminEndsItsSessions_thenItsStaleCopyCannotReturn()
            throws Exception {
        // given
        Cookie member = signIn("member");
        Cookie admin = signIn("admin");
        Session inFlight = onlySession("member");

        // when
        mockMvc.perform(delete("/api/admin/roster/{personId}/account/sessions", targetPersonId)
                        .cookie(admin).with(csrf()))
                .andExpect(status().isNoContent());
        inFlight.setLastAccessedTime(inFlight.getLastAccessedTime().plusSeconds(1));
        save(inFlight);

        // then
        assertThat(sessionRepository.findByPrincipalName("member")).isEmpty();
        mockMvc.perform(get("/api/session").cookie(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").cookie(admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenRequestsAreInFlight_whenAnAdminEndsEverySession_thenNoStaleCopyCanReturn()
            throws Exception {
        // given
        Cookie member = signIn("member");
        Cookie admin = signIn("admin");
        Session memberInFlight = onlySession("member");
        Session adminInFlight = onlySession("admin");

        // when
        mockMvc.perform(delete("/api/admin/sessions").cookie(admin).with(csrf()))
                .andExpect(status().isNoContent());
        memberInFlight.setLastAccessedTime(memberInFlight.getLastAccessedTime().plusSeconds(1));
        adminInFlight.setLastAccessedTime(adminInFlight.getLastAccessedTime().plusSeconds(1));
        save(memberInFlight);
        save(adminInFlight);

        // then
        assertThat(sessionRepository.findByPrincipalName("member")).isEmpty();
        assertThat(sessionRepository.findByPrincipalName("admin")).isEmpty();
        mockMvc.perform(get("/api/session").cookie(member)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").cookie(admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    private Cookie signIn(String username) throws Exception {
        Cookie session = mockMvc.perform(post("/api/session")
                        .param("username", username).param("password", PASSWORD).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("SESSION");
        assertThat(session).isNotNull();
        return session;
    }

    private Session onlySession(String username) {
        return sessionRepository.findByPrincipalName(username).values().stream()
                .findFirst().orElseThrow();
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void save(Session session) {
        ((SessionRepository) sessionRepository).save(session);
    }
}
