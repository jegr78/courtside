package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {"courtside.login-protection.address.max-failures=3",
        "courtside.credential-issue.max-per-window=1"})
class AccountRecoveryTest extends AbstractIntegrationTest {

    private static final String SHARED_ADDRESS = "roe@example.org";

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAMemberWhoForgotTheirPassword_whenTheyAskByName_thenTheInstanceIssuesANewOne()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        String before = accounts.findById(account).orElseThrow().getPasswordHash();

        // when
        askForAPassword("doe.jane", "192.0.2.10").andExpect(status().isAccepted());

        // then
        UserAccount reissued = accounts.findById(account).orElseThrow();
        assertThat(reissued.getPasswordHash())
                .as("the member signs in with something the board never saw")
                .isNotEqualTo(before);
        assertThat(reissued.isPasswordChangeRequired())
                .as("the first sign-in with it can do nothing except replace it")
                .isTrue();
    }

    @Test
    void givenANameNobodyHolds_whenItIsAsked_thenTheAnswerCannotBeToldFromTheOne() throws Exception {
        // given
        account("doe.jane", "jane.doe@example.org");

        // when
        MockHttpServletResponse known = askForAPassword("doe.jane", "192.0.2.11")
                .andReturn().getResponse();
        MockHttpServletResponse guessed = askForAPassword("nobody.here", "192.0.2.12")
                .andReturn().getResponse();

        // then
        assertThat(guessed.getStatus()).isEqualTo(known.getStatus()).isEqualTo(202);
        assertThat(guessed.getContentAsString()).isEqualTo(known.getContentAsString()).isEmpty();
        assertThat(new TreeSet<>(guessed.getHeaderNames()))
                .as("a header only one of them carries would answer the question the body refuses")
                .isEqualTo(new TreeSet<>(known.getHeaderNames()));
    }

    @Test
    void givenAnAddressTwoAccountsShare_whenItIsAsked_thenEachIsRemindedAndNoPasswordChanges()
            throws Exception {
        // given
        UUID parent = account("roe.john", SHARED_ADDRESS);
        UUID child = account("roe.jane", SHARED_ADDRESS);
        String parentBefore = accounts.findById(parent).orElseThrow().getPasswordHash();
        String childBefore = accounts.findById(child).orElseThrow().getPasswordHash();

        // when
        askForNames(SHARED_ADDRESS, "192.0.2.13").andExpect(status().isAccepted());

        // then
        assertThat(remindedAccounts()).containsExactlyInAnyOrder(parent, child);
        assertThat(accounts.findById(parent).orElseThrow().getPasswordHash())
                .as("a child who forgot their password does not cost their parent theirs")
                .isEqualTo(parentBefore);
        assertThat(accounts.findById(child).orElseThrow().getPasswordHash()).isEqualTo(childBefore);
    }

    @Test
    void givenAnAddressNobodyUses_whenItIsAsked_thenNothingIsSentAndTheAnswerIsTheSame()
            throws Exception {
        // given
        account("doe.jane", "jane.doe@example.org");

        // when
        askForNames("stranger@example.org", "192.0.2.14").andExpect(status().isAccepted());

        // then
        assertThat(remindedAccounts()).isEmpty();
    }

    @Test
    void givenACallerThatKeepsAsking_whenTheWindowIsFull_thenTheRefusalNamesTheRecoveryLimit()
            throws Exception {
        // given
        account("doe.jane", "jane.doe@example.org");

        // when
        for (int asked = 0; asked < 3; asked++) {
            askForAPassword("name" + asked, "192.0.2.15").andExpect(status().isAccepted());
        }

        // then
        askForAPassword("doe.jane", "192.0.2.15")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-rate-limited"))
                .andExpect(result -> assertThat(result.getResponse().getHeader("Retry-After"))
                        .as("a caller that is told to wait is told how long")
                        .isNotNull());
    }

    @Test
    void givenANameTheContractCouldNeverHaveIssued_whenItIsSubmitted_thenItIsRefusedOnItsShape()
            throws Exception {
        // when / then
        askForAPassword("Jane Doe", "192.0.2.16")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"));
    }

    @Test
    void givenAnAccountAtItsIssuingLimit_whenItIsAskedForAgain_thenTheAnswerStillSaysNothing()
            throws Exception {
        // given
        account("doe.jane", "jane.doe@example.org");
        askForAPassword("doe.jane", "192.0.2.17").andExpect(status().isAccepted());

        // when
        MockHttpServletResponse atTheLimit = askForAPassword("doe.jane", "192.0.2.18")
                .andReturn().getResponse();

        // then
        MockHttpServletResponse guessed = askForAPassword("nobody.here", "192.0.2.19")
                .andReturn().getResponse();
        assertThat(atTheLimit.getStatus())
                .as("a name whose mailbox has had enough must not read differently from one nobody holds")
                .isEqualTo(guessed.getStatus()).isEqualTo(202);
        assertThat(atTheLimit.getContentAsString()).isEqualTo(guessed.getContentAsString()).isEmpty();
        assertThat(new TreeSet<>(atTheLimit.getHeaderNames()))
                .as("a header only one of them carries would answer the question the body refuses")
                .isEqualTo(new TreeSet<>(guessed.getHeaderNames()));
    }

    @Test
    void givenAnAccountNothingCanBeSentTo_whenItsNameIsAsked_thenItReadsLikeANameNobodyHolds()
            throws Exception {
        // given
        UserAccount deactivated = accounts.findById(account("doe.jane", "jane.doe@example.org"))
                .orElseThrow();
        deactivated.disable();
        accounts.save(deactivated);
        UUID withoutAnAddress = account("roe.john", "");
        String before = accounts.findById(withoutAnAddress).orElseThrow().getPasswordHash();

        // when
        MockHttpServletResponse disabled = askForAPassword("doe.jane", "192.0.2.20")
                .andReturn().getResponse();
        MockHttpServletResponse unreachable = askForAPassword("roe.john", "192.0.2.21")
                .andReturn().getResponse();
        MockHttpServletResponse guessed = askForAPassword("nobody.here", "192.0.2.22")
                .andReturn().getResponse();

        // then
        for (MockHttpServletResponse answer : List.of(disabled, unreachable)) {
            assertThat(answer.getStatus()).isEqualTo(guessed.getStatus()).isEqualTo(202);
            assertThat(answer.getContentAsString()).isEqualTo(guessed.getContentAsString()).isEmpty();
            assertThat(new TreeSet<>(answer.getHeaderNames()))
                    .isEqualTo(new TreeSet<>(guessed.getHeaderNames()));
        }
        assertThat(issuedCredentials())
                .as("an account nothing can be sent to is answered the same way and sent nothing")
                .isEmpty();
        assertThat(accounts.findById(withoutAnAddress).orElseThrow().getPasswordHash())
                .isEqualTo(before);
    }

    @Test
    void givenARecoveryRequest_whenItIsAdmitted_thenItCountsTowardsTheInstanceWideObservation()
            throws Exception {
        // given
        account("doe.jane", "jane.doe@example.org");
        int before = globalAttempts();

        // when
        askForAPassword("doe.jane", "192.0.2.23").andExpect(status().isAccepted());
        askForNames("stranger@example.org", "192.0.2.24").andExpect(status().isAccepted());

        // then
        assertThat(globalAttempts())
                .as("a campaign thin enough to miss both buckets still has to move this count")
                .isEqualTo(before + 2);
    }

    private int globalAttempts() {
        return jdbc.sql("SELECT attempt_count FROM login_attempt_limit WHERE scope = 'GLOBAL'")
                .query(Integer.class).optional().orElse(0);
    }

    private List<UUID> issuedCredentials() {
        return jdbc.sql("""
                        SELECT account_id FROM message_record
                        WHERE kind IN ('CREDENTIALS_NEW_ACCOUNT', 'CREDENTIALS_PASSWORD_RESET')
                        """)
                .query(UUID.class).list();
    }

    private List<UUID> remindedAccounts() {
        return jdbc.sql("""
                        SELECT account_id FROM message_record
                        WHERE kind = 'ACCOUNT_USERNAME_REMINDER'
                        """)
                .query(UUID.class).list();
    }

    private ResultActions askForAPassword(String username, String from) throws Exception {
        return ask("/api/account-recovery/password", "{\"username\":\"" + username + "\"}", from);
    }

    private ResultActions askForNames(String email, String from) throws Exception {
        return ask("/api/account-recovery/usernames", "{\"email\":\"" + email + "\"}", from);
    }

    private ResultActions ask(String path, String body, String from) throws Exception {
        return mockMvc.perform(post(path)
                .with(request -> {
                    request.setRemoteAddr(from);
                    return request;
                })
                .with(csrf()).contentType("application/json").content(body));
    }

    private UUID account(String username, String email) {
        Person person = persons.save(new Person("Jane", "Doe", email));
        return accounts.save(enabled(new UserAccount(person, username,
                passwordEncoder.encode("a-password-they-forgot"), Set.of(Role.MEMBER), "en")))
                .getId();
    }
}
