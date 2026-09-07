package org.courtside.identity;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AccountSessionLifecycleTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery";

    @Autowired private WebApplicationContext context;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @Autowired private FindByIndexNameSessionRepository<? extends Session> sessionRepository;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private ObjectMapper json;
    @Autowired private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions).apply(springSecurity()).build();
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(person, "doe.jane", passwordEncoder.encode(PASSWORD),
                Set.of(Role.MEMBER), "en")));
    }

    @Test
    void givenTwoActiveSessions_whenOneIsListedAndEnded_thenOnlyPrivacySafeMetadataAndTheOtherRemain()
            throws Exception {
        // given
        Cookie firefox = signIn("Mozilla/5.0 Firefox/142.0");
        Cookie edge = signIn("Mozilla/5.0 Edg/140.0 Chrome/140.0");

        // when
        String body = mockMvc.perform(get("/api/account/sessions").cookie(edge))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain(firefox.getValue(), edge.getValue(), "userAgent", "ipAddress");
        JsonNode sessions = json.readTree(body);
        assertThat(sessions.toString()).as("session metadata returned by the API")
                .contains("\"current\":true", "\"browserFamily\":\"EDGE\"",
                        "\"browserFamily\":\"FIREFOX\"");
        String firefoxHandle = null;
        for (JsonNode session : sessions) {
            if (session.get("browserFamily").asText().equals("FIREFOX")) {
                firefoxHandle = session.get("handle").asText();
            }
        }
        assertThat(firefoxHandle).isNotNull().hasSize(22);

        // when
        mockMvc.perform(delete("/api/account/sessions/{handle}", firefoxHandle)
                        .cookie(edge).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/session").cookie(firefox))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").cookie(edge))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenIdentifyingTransportMetadata_whenLoginSucceeds_thenTheStoredSessionRetainsNeitherValue()
            throws Exception {
        // given
        String remoteAddress = "198.51.100.73";
        String rawUserAgent = "raw-private-browser/73";

        // when
        mockMvc.perform(post("/api/session")
                        .with(request -> {
                            request.setRemoteAddr(remoteAddress);
                            return request;
                        })
                        .header("User-Agent", rawUserAgent)
                        .param("username", "doe.jane").param("password", PASSWORD).with(csrf()))
                .andExpect(status().isOk());

        // then
        assertThat(jdbc.sql("SELECT ATTRIBUTE_BYTES FROM SPRING_SESSION_ATTRIBUTES")
                .query(byte[].class).list())
                .isNotEmpty()
                .allSatisfy(attributes -> assertThat(new String(attributes,
                        java.nio.charset.StandardCharsets.ISO_8859_1))
                        .doesNotContain(remoteAddress, rawUserAgent));
    }

    @Test
    void givenNoExistingSession_whenLoginFails_thenNoAnonymousSessionIsPersisted() throws Exception {
        // given
        long sessionsBefore = storedSessionCount();

        // when
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane").param("password", "wrong-password")
                        .with(csrf()))
                .andExpect(status().isUnauthorized());

        // then
        assertThat(storedSessionCount()).isEqualTo(sessionsBefore);
    }

    private long storedSessionCount() {
        return jdbc.sql("SELECT COUNT(*) FROM SPRING_SESSION").query(Long.class).single();
    }

    @Test
    void givenAnActiveSession_whenAllAreEnded_thenReauthenticationIsRequiredAndTheCallerEnds()
            throws Exception {
        // given
        Cookie session = signIn("test-client");
        Session stored = sessionRepository.findByPrincipalName("doe.jane").values().stream()
                .findFirst().orElseThrow();
        stored.removeAttribute(RecentAuthentication.AUTHENTICATED_AT);
        save(stored);
        long epochBefore = accounts.findByUsername("doe.jane").orElseThrow().getSecurityEpoch();

        // when / then
        mockMvc.perform(delete("/api/account/sessions").cookie(session).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:recent-authentication-required"));
        assertThat(sessionRepository.findByPrincipalName("doe.jane")).hasSize(1);
        assertThat(accounts.findByUsername("doe.jane").orElseThrow().getSecurityEpoch())
                .isEqualTo(epochBefore);
        mockMvc.perform(post("/api/session/reauthentication").cookie(session).with(csrf())
                        .contentType("application/json").content("{\"password\":\"wrong-password\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));
        mockMvc.perform(post("/api/session/reauthentication").cookie(session).with(csrf())
                        .contentType("application/json").content("{\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isNoContent());

        // when
        mockMvc.perform(delete("/api/account/sessions").cookie(session).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/session").cookie(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void givenARequestHoldingAStaleSessionCopy_whenThatSessionIsEnded_thenSavingCannotResurrectIt()
            throws Exception {
        // given
        Cookie firefox = signIn("Mozilla/5.0 Firefox/142.0");
        Cookie edge = signIn("Mozilla/5.0 Edg/140.0 Chrome/140.0");
        Session inFlight = sessionRepository.findByPrincipalName("doe.jane").values().stream()
                .filter(session -> "FIREFOX".equals(session.getAttribute("courtside.browser-family")))
                .findFirst().orElseThrow();
        JsonNode listed = json.readTree(mockMvc.perform(get("/api/account/sessions").cookie(edge))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String firefoxHandle = null;
        for (JsonNode session : listed) {
            if (session.get("browserFamily").asText().equals("FIREFOX")) {
                firefoxHandle = session.get("handle").asText();
            }
        }
        assertThat(firefoxHandle).isNotNull();

        // when
        mockMvc.perform(delete("/api/account/sessions/{handle}", firefoxHandle)
                        .cookie(edge).with(csrf()))
                .andExpect(status().isNoContent());
        inFlight.setLastAccessedTime(inFlight.getLastAccessedTime().plusSeconds(1));
        save(inFlight);

        // then
        assertThat(sessionRepository.findByPrincipalName("doe.jane")).hasSize(1);
        mockMvc.perform(get("/api/session").cookie(firefox))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
    }

    private Cookie signIn(String userAgent) throws Exception {
        Cookie session = mockMvc.perform(post("/api/session")
                        .header("User-Agent", userAgent)
                        .param("username", "doe.jane").param("password", PASSWORD).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("SESSION");
        assertThat(session).isNotNull();
        return session;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void save(Session session) {
        ((SessionRepository) sessionRepository).save(session);
    }
}
