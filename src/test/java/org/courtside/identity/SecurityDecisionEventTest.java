package org.courtside.identity;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SecurityDecisionEventTest extends AbstractIntegrationTest {

    private static final String USERNAME = "doe.jane";
    private static final String PASSWORD = "correct-horse";

    @Autowired
    private WebApplicationContext context;
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
    void setUp() throws Exception {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accountId = accounts.save(enabled(new UserAccount(
                jane, USERNAME, passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER), "de"))).getId();
        recorded.start();
        eventLogger().addAppender(recorded);
    }

    @AfterEach
    void tearDown() {
        eventLogger().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenAKnownMember_whenAnAdminRequestIsRefused_thenAuthorizationIsRecorded() throws Exception {
        MockHttpSession session = signIn();

        mockMvc.perform(get("/api/admin/config").session(session))
                .andExpect(status().isForbidden());

        assertThat(fieldsOf("courtside.authorization.denied")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.authorization.denied",
                "event.outcome", "failure",
                "account.id", accountId.toString()));
        assertRequestCorrelation("courtside.authorization.denied");
    }

    @Test
    void givenAKnownAccount_whenCsrfRefusesAWrite_thenTheControlAndNoPayloadAreRecorded() throws Exception {
        MockHttpSession session = signIn();
        String injected = "{\"event.code\":\"forged\",\"password\":\"secret\"}";

        mockMvc.perform(put("/api/account/locale")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(injected))
                .andExpect(status().isForbidden());

        assertThat(fieldsOf("courtside.control.refused")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.control.refused",
                "event.outcome", "failure",
                "event.reason", "CSRF",
                "account.id", accountId.toString()));
        assertRequestCorrelation("courtside.control.refused");
        assertThat(recorded.list).allSatisfy(event -> assertThat(event.toString())
                .doesNotContain("forged", "password", "secret"));
    }

    @Test
    void givenAKnownAccount_whenItSignsOut_thenTheSessionTerminationIsRecorded() throws Exception {
        MockHttpSession session = signIn();

        mockMvc.perform(post("/api/session/logout").session(session).with(csrf()))
                .andExpect(status().isNoContent());

        assertThat(fieldsOf("courtside.session.terminated")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.session.terminated",
                "event.outcome", "success",
                "event.reason", "EXPLICIT_LOGOUT",
                "account.id", accountId.toString(),
                "actor.account.id", accountId.toString()));
        assertRequestCorrelation("courtside.session.terminated");
    }

    @Test
    void givenAKnownAccount_whenRequestValidationRefusesInput_thenTheControlIsRecordedWithoutInput()
            throws Exception {
        MockHttpSession session = signIn();
        String injected = "forged-private-value";

        mockMvc.perform(put("/api/account/locale")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locale\":\"" + injected + "\"")
                        .with(csrf()))
                .andExpect(status().isBadRequest());

        assertThat(fieldsOf("courtside.control.refused")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.control.refused",
                "event.outcome", "failure",
                "event.reason", "REQUEST_VALIDATION",
                "account.id", accountId.toString()));
        assertRequestCorrelation("courtside.control.refused");
        assertThat(recorded.list).allSatisfy(event -> assertThat(event.toString())
                .doesNotContain(injected));
    }

    @Test
    void givenAnAdminChangesAccountSecurity_whenTheTransactionCommits_thenSubjectAndActorAreRecorded()
            throws Exception {
        Person administrator = persons.save(new Person("Ada", "Admin", "admin@example.org"));
        UUID administratorId = accounts.save(enabled(new UserAccount(
                administrator, "admin", passwordEncoder.encode(PASSWORD), Set.of(Role.ADMIN), "de"))).getId();
        UUID personId = accounts.findById(accountId).orElseThrow().getPerson().getId();
        MockHttpSession session = signIn("admin");

        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", personId)
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"roles\":[\"MEMBER\",\"TRAINER\"]}")
                        .with(csrf()))
                .andExpect(status().isOk());

        assertThat(fieldsOf("courtside.administration.security-action"))
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "event.code", "courtside.administration.security-action",
                        "event.outcome", "success",
                        "event.action", "ROLES_CHANGED",
                        "account.id", accountId.toString(),
                        "actor.account.id", administratorId.toString()));
        assertRequestCorrelation("courtside.administration.security-action");
    }

    @Test
    void givenTheOnlyAdminWouldRemoveItsRole_whenContinuityRefusesIt_thenTheGuardIsRecorded()
            throws Exception {
        Person administrator = persons.save(new Person("Ada", "Admin", "admin@example.org"));
        UserAccount adminAccount = accounts.save(enabled(new UserAccount(
                administrator, "admin", passwordEncoder.encode(PASSWORD), Set.of(Role.ADMIN), "de")));
        MockHttpSession session = signIn("admin");

        mockMvc.perform(put("/api/admin/roster/{personId}/account/roles", administrator.getId())
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"roles\":[\"MEMBER\"]}")
                        .with(csrf()))
                .andExpect(status().isConflict());

        assertThat(fieldsOf("courtside.control.refused")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.control.refused",
                "event.outcome", "failure",
                "event.reason", "ADMINISTRATOR_CONTINUITY",
                "account.id", adminAccount.getId().toString()));
        assertRequestCorrelation("courtside.control.refused");
    }

    private MockHttpSession signIn() throws Exception {
        return signIn(USERNAME);
    }

    private MockHttpSession signIn(String username) throws Exception {
        MockHttpSession session = (MockHttpSession) mockMvc.perform(post("/api/session")
                        .param("username", username)
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
        recorded.list.clear();
        return session;
    }

    private Map<String, Object> fieldsOf(String code) {
        return fields(eventOf(code));
    }

    private ILoggingEvent eventOf(String code) {
        return recorded.list.stream()
                .filter(candidate -> code.equals(fields(candidate).get("event.code")))
                .findFirst()
                .orElseThrow();
    }

    private void assertRequestCorrelation(String code) {
        assertThat(eventOf(code).getMDCPropertyMap()).containsKeys("traceId", "spanId");
    }

    private static Map<String, Object> fields(ILoggingEvent event) {
        Map<String, Object> fields = new LinkedHashMap<>();
        event.getKeyValuePairs().forEach(pair -> fields.put(pair.key, pair.value));
        return fields;
    }

    private static Logger eventLogger() {
        return (Logger) LoggerFactory.getLogger("org.courtside.security.events");
    }
}
