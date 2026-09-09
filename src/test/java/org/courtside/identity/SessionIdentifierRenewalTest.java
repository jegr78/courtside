package org.courtside.identity;

import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
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

class SessionIdentifierRenewalTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery";

    @Autowired private WebApplicationContext context;
    @Autowired private SessionRepositoryFilter<?> storedSessions;
    @Autowired private FindByIndexNameSessionRepository<? extends Session> sessionRepository;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;
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
    void givenASignedInSession_whenReauthenticationSucceeds_thenTheEarlierIdentifierNoLongerAuthorizes()
            throws Exception {
        // given
        Cookie signedIn = signIn();
        String earlier = storedId(signedIn);

        // when
        Cookie renewed = reauthenticate(signedIn, PASSWORD)
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie("SESSION");

        // then
        assertThat(renewed).as("the browser is handed the replacement or it keeps sending the"
                + " identifier this operation was meant to retire").isNotNull();
        assertThat(storedId(renewed)).isNotEqualTo(earlier);
        assertThat(sessionRepository.findById(earlier))
                .as("an identifier an attacker may already hold must stop resolving").isNull();
        mockMvc.perform(get("/api/session").cookie(signedIn))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").cookie(renewed))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void givenASignedInSession_whenReauthenticationSucceeds_thenTheRenewedSessionCarriesTheProofAndTheBrowser()
            throws Exception {
        // given
        Cookie signedIn = signIn();

        // when
        Cookie renewed = reauthenticate(signedIn, PASSWORD)
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie("SESSION");

        // then
        assertThat(renewed).as("without a replacement cookie there is nothing to carry the"
                + " proof forward").isNotNull();
        Session after = sessionRepository.findById(storedId(renewed));
        assertThat(after).isNotNull();
        assertThat((Long) after.getAttribute(RecentAuthentication.AUTHENTICATED_AT))
                .as("the proof the operation grants has to travel to the session that replaces it")
                .isNotNull();
        assertThat((String) after.getAttribute("courtside.browser-family"))
                .as("the member sees this session in their own session list, so replacing the"
                        + " session must not lose what it was signed in from")
                .isEqualTo("FIREFOX");
        mockMvc.perform(get("/api/session").cookie(renewed))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.username").value("doe.jane"));
    }

    @Test
    void givenASignedInSession_whenReauthenticationSucceeds_thenItStoresANewRowRatherThanRotatingInPlace()
            throws Exception {
        // given
        Cookie signedIn = signIn();
        String earlierRow = primaryIdOf(storedId(signedIn));

        // when
        Cookie renewed = reauthenticate(signedIn, PASSWORD)
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie("SESSION");
        assertThat(renewed).isNotNull();

        // then
        assertThat(primaryIdOf(storedId(renewed)))
                .as("rotating inside the row leaves a request in flight able to write the retired"
                        + " identifier back, because every such request rewrites SESSION_ID from"
                        + " its own copy; replacing the row is what makes that write hit nothing")
                .isNotEqualTo(earlierRow);
    }

    private String primaryIdOf(String identifier) {
        return jdbc.sql("SELECT primary_id FROM spring_session WHERE session_id = :id")
                .param("id", identifier).query(String.class).single();
    }

    @Test
    void givenASignedInSession_whenReauthenticationFails_thenNeitherTheIdentifierNorTheProofChanges()
            throws Exception {
        // given
        Cookie signedIn = signIn();
        String earlier = storedId(signedIn);
        clearProof(earlier);

        // when
        reauthenticate(signedIn, "wrong-password")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:reauthentication-failed"));

        // then
        Session unchanged = sessionRepository.findById(earlier);
        assertThat(unchanged).as("a refused proof rotates nothing").isNotNull();
        assertThat((Long) unchanged.getAttribute(RecentAuthentication.AUTHENTICATED_AT))
                .as("signing in already grants a proof, so the attribute is cleared first; a"
                        + " refused proof must not put one back").isNull();
    }

    @Test
    void givenARequestHoldingASessionCopyFromBeforeTheProof_whenItSaves_thenItCannotRestoreTheEarlierIdentifier()
            throws Exception {
        // given
        Cookie signedIn = signIn();
        String earlier = storedId(signedIn);
        Session inFlight = sessionRepository.findById(earlier);
        assertThat(inFlight).isNotNull();

        // when
        Cookie renewed = reauthenticate(signedIn, PASSWORD)
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie("SESSION");
        assertThat(renewed).isNotNull();
        inFlight.setLastAccessedTime(inFlight.getLastAccessedTime().plusSeconds(1));
        save(inFlight);

        // then
        assertThat(sessionRepository.findById(earlier))
                .as("every request carrying a session cookie rewrites the whole row, so one in"
                        + " flight during the proof must not write the retired identifier back")
                .isNull();
        mockMvc.perform(get("/api/session").cookie(signedIn))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(false));
        mockMvc.perform(get("/api/session").cookie(renewed))
                .andExpect(status().isOk()).andExpect(jsonPath("$.authenticated").value(true));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void save(Session session) {
        ((SessionRepository) sessionRepository).save(session);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private void clearProof(String identifier) {
        Session session = sessionRepository.findById(identifier);
        assertThat(session).isNotNull();
        session.removeAttribute(RecentAuthentication.AUTHENTICATED_AT);
        ((SessionRepository) sessionRepository).save(session);
    }

    private ResultActions reauthenticate(Cookie session, String password) throws Exception {
        return mockMvc.perform(post("/api/session/reauthentication")
                .cookie(session).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"" + password + "\"}"));
    }

    private Cookie signIn() throws Exception {
        Cookie session = mockMvc.perform(post("/api/session")
                        .header("User-Agent", "Mozilla/5.0 Firefox/142.0")
                        .param("username", "doe.jane").param("password", PASSWORD).with(csrf()))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("SESSION");
        assertThat(session).isNotNull();
        return session;
    }

    private String storedId(Cookie session) {
        return new String(Base64.getDecoder().decode(session.getValue()), StandardCharsets.UTF_8);
    }
}
