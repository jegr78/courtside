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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthenticationSecurityEventTest extends AbstractIntegrationTest {

    private static final String USERNAME = "doe.jane";
    private static final String PASSWORD = "correct-horse";
    private static final String EMAIL = "jane.doe@example.org";

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
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        Person jane = persons.save(new Person("Jane", "Doe", EMAIL));
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
    void givenAKnownAccount_whenItSignsIn_thenTheSuccessUsesOnlyItsImmutableId() throws Exception {
        // when
        mockMvc.perform(post("/api/session")
                        .param("username", USERNAME)
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        assertThat(fieldsOf("courtside.authentication.succeeded")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.authentication.succeeded",
                "event.outcome", "success",
                "account.id", accountId.toString()));
        assertRequestCorrelation("courtside.authentication.succeeded");
        assertNoPrivateText();
    }

    @Test
    void givenAKnownAccount_whenItsPasswordIsWrong_thenTheFailureNamesAStableReason() throws Exception {
        // when
        mockMvc.perform(post("/api/session")
                        .param("username", USERNAME)
                        .param("password", "wrong-secret")
                        .with(csrf()))
                .andExpect(status().isUnauthorized());

        // then
        assertThat(fieldsOf("courtside.authentication.failed")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.authentication.failed",
                "event.outcome", "failure",
                "event.reason", "BAD_CREDENTIALS",
                "account.id", accountId.toString()));
        assertNoPrivateText();
    }

    @Test
    void givenAnUnknownLoginIdentifier_whenItIsRefused_thenNoIdentifierOrForgedFieldIsLogged()
            throws Exception {
        // given
        String submitted = "nobody\n{\"event.code\":\"forged\"}";

        // when
        mockMvc.perform(post("/api/session")
                        .param("username", submitted)
                        .param("password", "wrong-secret")
                        .with(csrf()))
                .andExpect(status().isUnauthorized());

        // then
        assertThat(fieldsOf("courtside.authentication.failed")).containsExactlyInAnyOrderEntriesOf(Map.of(
                "event.code", "courtside.authentication.failed",
                "event.outcome", "failure",
                "event.reason", "BAD_CREDENTIALS"));
        assertThat(recorded.list).allSatisfy(event -> assertThat(event.toString())
                .doesNotContain(submitted, "forged"));
    }

    private Map<String, Object> fieldsOf(String code) {
        return fields(eventOf(code));
    }

    private void assertRequestCorrelation(String code) {
        assertThat(eventOf(code).getMDCPropertyMap()).containsKeys("traceId", "spanId");
    }

    private ILoggingEvent eventOf(String code) {
        return recorded.list.stream()
                .filter(candidate -> code.equals(fields(candidate).get("event.code")))
                .findFirst()
                .orElseThrow();
    }

    private void assertNoPrivateText() {
        assertThat(recorded.list).allSatisfy(event -> assertThat(event.toString())
                .doesNotContain(USERNAME, PASSWORD, EMAIL, "Jane", "Doe"));
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
