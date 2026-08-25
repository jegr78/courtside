package org.courtside.identity;

import ch.qos.logback.classic.Level;
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

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class SignInFailureLogTest extends AbstractIntegrationTest {

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
        signInLog().addAppender(recorded);
    }

    @AfterEach
    void tearDown() {
        signInLog().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenAKnownAccount_whenThePasswordIsWrong_thenTheRefusalNamesTheReasonAndTheAccount()
            throws Exception {
        // when
        attempt(USERNAME, "battery-staple");

        // then
        assertThat(messages()).anySatisfy(message -> assertThat(message)
                .contains("BAD_CREDENTIALS")
                .contains(accountId.toString()));
    }

    @Test
    void givenAnUnknownUsername_whenSomebodyTriesIt_thenTheRefusalCarriesNoIdentifier()
            throws Exception {
        // when
        attempt("nobody.here", "battery-staple");

        // then
        assertThat(messages()).anySatisfy(message -> assertThat(message)
                .contains("BAD_CREDENTIALS")
                .doesNotContain("account "));
    }

    @Test
    void givenADeactivatedAccount_whenItTriesToSignIn_thenTheRefusalSaysSoRatherThanBlamingThePassword()
            throws Exception {
        // given
        UserAccount account = accounts.findByUsername(USERNAME).orElseThrow();
        account.disable();
        accounts.save(account);

        // when
        attempt(USERNAME, PASSWORD);

        // then
        assertThat(messages()).anySatisfy(message -> assertThat(message)
                .contains("DISABLED")
                .contains(accountId.toString()));
    }

    @Test
    void whenASignInIsRefused_thenNothingInTheLogNamesThePersonOrTheirAddress() throws Exception {
        // when
        attempt(USERNAME, "battery-staple");

        // then
        assertThat(messages()).isNotEmpty().allSatisfy(message -> assertThat(message)
                .doesNotContain(USERNAME)
                .doesNotContain(EMAIL)
                .doesNotContain("Jane")
                .doesNotContain("Doe"));
    }

    private void attempt(String username, String password) throws Exception {
        mockMvc.perform(post("/api/session")
                .param("username", username)
                .param("password", password)
                .with(csrf()));
    }

    private List<String> messages() {
        return recorded.list.stream()
                .filter(event -> event.getLevel().isGreaterOrEqual(Level.INFO))
                .map(ILoggingEvent::getFormattedMessage)
                .toList();
    }

    private static Logger signInLog() {
        return (Logger) LoggerFactory.getLogger("org.courtside.identity.internal.SignInFailureLog");
    }
}
