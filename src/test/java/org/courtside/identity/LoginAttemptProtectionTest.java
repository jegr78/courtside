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
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=2",
        "courtside.login-protection.global.max-failures=20"
})
class LoginAttemptProtectionTest extends AbstractIntegrationTest {

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

    private final ListAppender<ILoggingEvent> recorded = new ListAppender<>();

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        recorded.start();
        blockLog().addAppender(recorded);
    }

    @AfterEach
    void tearDown() {
        blockLog().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenAnAddressThatIsBlocked_whenItTriesAgain_thenTheRefusalNamesTheLimitThatHolds()
            throws Exception {
        // given
        failLogin("first", "192.0.2.60");
        failLogin("second", "192.0.2.60");

        // when
        mockMvc.perform(login("third", "wrong", "192.0.2.60"))
                .andExpect(status().isTooManyRequests());

        // then — which limit holds decides whether one client or the whole instance is affected
        assertThat(blockMessages()).anySatisfy(message -> assertThat(message)
                .contains("ADDRESS")
                .doesNotContain("192.0.2.60"));
    }

    private List<String> blockMessages() {
        return recorded.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private static Logger blockLog() {
        return (Logger) LoggerFactory.getLogger("org.courtside.identity.internal.LoginAttemptFilter");
    }

    @Test
    void givenRepeatedFailuresFromOneAddress_whenLoggingInAgain_thenTheAttemptIsRateLimited()
            throws Exception {
        // given
        failLogin("first", "192.0.2.10");
        failLogin("second", "192.0.2.10");

        // when / then
        mockMvc.perform(login("third", "wrong", "192.0.2.10"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:login-rate-limited"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("identity.login.rateLimited"));
    }

    @Test
    void givenRepeatedFailuresForOneUsername_whenCorrectCredentialsArrive_thenTheAccountIsNotLocked()
            throws Exception {
        // given
        Person admin = persons.save(new Person("Ada", "Admin", "admin@example.org"));
        UserAccount account = new UserAccount(
                admin, "admin", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de");
        account.enable();
        accounts.save(account);
        failLogin("admin", "192.0.2.11");
        failLogin("admin", "192.0.2.12");

        // when / then
        mockMvc.perform(login("admin", "correct-horse", "192.0.2.13"))
                .andExpect(status().isOk());
    }

    @Test
    void givenAFailureFollowedBySuccess_whenAnotherFailureOccurs_thenTheCountersStartAgain()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.MEMBER), "de");
        account.enable();
        accounts.save(account);
        failLogin("doe.jane", "192.0.2.20");
        mockMvc.perform(login("doe.jane", "correct-horse", "192.0.2.20"))
                .andExpect(status().isOk());

        // when / then
        failLogin("doe.jane", "192.0.2.20");
        mockMvc.perform(login("doe.jane", "wrong", "192.0.2.20"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenAnExpiredBlock_whenLoggingInAgain_thenAuthenticationIsAttempted() throws Exception {
        // given
        failLogin("expired.user", "192.0.2.30");
        failLogin("expired.user", "192.0.2.30");
        jdbc.sql("""
                        UPDATE login_attempt_limit
                        SET blocked_until = TIMESTAMPTZ '2026-05-12 09:59:00Z',
                            window_started_at = TIMESTAMPTZ '2026-05-12 09:00:00Z'
                        """).update();

        // when / then
        mockMvc.perform(login("expired.user", "wrong", "192.0.2.30"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenAFractionalCooldown_whenTheAttemptIsLimited_thenRetryAfterRoundsUp()
            throws Exception {
        // given
        failLogin("first", "192.0.2.50");
        failLogin("second", "192.0.2.50");
        jdbc.sql("""
                        UPDATE login_attempt_limit
                        SET blocked_until = TIMESTAMPTZ '2026-05-12 10:00:59.500Z'
                        WHERE scope = 'ADDRESS'
                        """).update();

        // when / then
        mockMvc.perform(login("third", "wrong", "192.0.2.50"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"));
    }

    private void failLogin(String username, String address) throws Exception {
        mockMvc.perform(login(username, "wrong", address))
                .andExpect(status().isUnauthorized());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder login(
            String username, String password, String address) {
        return post("/api/session")
                .param("username", username)
                .param("password", password)
                .with(remoteAddress(address))
                .with(csrf());
    }

    private RequestPostProcessor remoteAddress(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }
}
