package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.IssuedResetCode;
import org.courtside.identity.internal.LoginVerificationCapacity;
import org.courtside.shared.PasswordResetCodeIssuer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
        "courtside.login-protection.verification-concurrency=1",
        "courtside.password-reset-mail.max-per-window=1"})
class AccountRecoveryTest extends AbstractIntegrationTest {

    private static final String SHARED_ADDRESS = "roe@example.org";

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcClient jdbc;
    @Autowired private PasswordResetCodeIssuer codes;
    @Autowired private Clock clock;

    @Autowired
    @Qualifier("credentialVerificationCapacity")
    private LoginVerificationCapacity credentialCapacity;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAMemberWhoForgotTheirPassword_whenTheyAskByName_thenNothingAboutTheirAccountChanges()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        UserAccount before = accounts.findById(account).orElseThrow();
        String hashBefore = before.getPasswordHash();
        long epochBefore = before.getSecurityEpoch();

        // when
        askForAPassword("doe.jane", "192.0.2.10").andExpect(status().isAccepted());

        // then
        UserAccount after = accounts.findById(account).orElseThrow();
        assertThat(after.getPasswordHash())
                .as("asking must cost the member nothing: the password they chose keeps working")
                .isEqualTo(hashBefore);
        assertThat(after.getSecurityEpoch())
                .as("and every session they hold keeps running")
                .isEqualTo(epochBefore);
        assertThat(after.isPasswordChangeRequired()).isFalse();
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
    void givenAnAccountAtItsMailWindow_whenItIsAskedForAgain_thenTheAnswerStillSaysNothing()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
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
        assertThat(mailedCodes())
                .as("the window protects the mailbox, so the second request has to cost it nothing")
                .containsExactly(account);
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
        assertThat(mailedCodes())
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

    @Test
    void givenACodeThatWasMailed_whenItIsRedeemed_thenThePasswordIsSetAndEverySessionEnds()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        UserAccount before = accounts.findById(account).orElseThrow();
        IssuedResetCode issued = codes.issueFor(account);

        // when
        redeem(issued.code(), "a-password-nobody-guessed").andExpect(status().isNoContent());

        // then
        UserAccount after = accounts.findById(account).orElseThrow();
        assertThat(after.getPasswordHash())
                .as("the member signs in with what they typed, not with what was mailed")
                .isNotEqualTo(before.getPasswordHash());
        assertThat(after.getSecurityEpoch()).isGreaterThan(before.getSecurityEpoch());
        assertThat(after.isPasswordChangeRequired())
                .as("a password the member chose is not one they have to replace")
                .isFalse();
        assertThat(outstandingCodes()).isEmpty();
    }

    @Test
    void givenACodeThatWasRedeemed_whenItIsPresentedAgain_thenItReadsLikeACodeNobodyHolds()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);
        redeem(issued.code(), "a-password-nobody-guessed").andExpect(status().isNoContent());

        // when / then
        redeem(issued.code(), "another-password-entirely")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-invalid"));
    }

    @Test
    void givenAPasswordTheRulesRefuse_whenItIsSubmitted_thenTheCodeIsStillGood() throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when — the username is a context term, so the rules refuse this one
        redeem(issued.code(), "doe.jane-doe.jane")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:password-too-guessable"));

        // then
        assertThat(outstandingCodes())
                .as("a member who has to correct their password still holds the code they were sent")
                .containsExactly(account);
        redeem(issued.code(), "a-password-nobody-guessed").andExpect(status().isNoContent());
    }

    @Test
    void givenACodeNobodyWasEverSent_whenItIsPresented_thenItIsRefusedAsInvalid() throws Exception {
        // when / then
        redeem("ABCD-EFGH", "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-invalid"));
    }

    @Test
    void givenASecondRequest_whenItIsMade_thenTheCodeFromTheFirstStopsWorking() throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode first = codes.issueFor(account);

        // when
        IssuedResetCode second = codes.issueFor(account);

        // then
        redeem(first.code(), "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-invalid"));
        redeem(second.code(), "a-password-nobody-guessed").andExpect(status().isNoContent());
    }

    @Test
    void givenACodeAndThenAChangedAddress_whenItIsRedeemed_thenItIsRefused() throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when — a message already sent cannot be recalled from a mailbox that was never theirs
        UserAccount held = accounts.findById(account).orElseThrow();
        held.getPerson().changeEmail("somebody.else@example.org");
        persons.save(held.getPerson());

        // then
        redeem(issued.code(), "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-invalid"));
    }

    @Test
    void givenACodeAndThenABoardIssuedCredential_whenItIsRedeemed_thenItIsRefused() throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when — anything that changed the way into the account withdraws what was outstanding
        UserAccount held = accounts.findById(account).orElseThrow();
        held.credentialsIssued(passwordEncoder.encode("issued-by-the-board"),
                clock.instant().plusSeconds(3600));
        accounts.save(held);

        // then
        redeem(issued.code(), "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-invalid"));
    }

    @Test
    void givenACodeWhoseWindowHasPassed_whenItIsRedeemed_thenItIsToldApartFromAnUnknownOne()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when
        expire(account);

        // then
        redeem(issued.code(), "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-expired"));
        // a member who tries the same code twice is told the same thing twice, not that it never was
        redeem(issued.code(), "a-password-nobody-guessed")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:account-recovery-code-expired"));
    }

    @Test
    void givenTheCredentialVerificationCapacityIsOccupied_whenACodeIsRedeemed_thenItIsRefusedLikeAnyOtherCredentialWork()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when / then
        try (LoginVerificationCapacity.Permit ignored = credentialCapacity.tryAcquire().orElseThrow()) {
            redeem(issued.code(), "a-password-nobody-guessed")
                    .andExpect(status().isTooManyRequests())
                    .andExpect(jsonPath("$.type")
                            .value("urn:courtside:error:password-verification-rate-limited"));
        }
        assertThat(outstandingCodes())
                .as("work the instance never did cannot have spent the code")
                .containsExactly(account);
        redeem(issued.code(), "a-password-nobody-guessed").andExpect(status().isNoContent());
    }

    @Test
    void givenAnAddressGuessingCodes_whenAMemberRedeemsTheirOwn_thenOnlyTheGuessersAddressIsBlocked()
            throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        IssuedResetCode issued = codes.issueFor(account);

        // when — three wrong codes is the configured address budget for this test
        for (int guess = 0; guess < 3; guess++) {
            redeem("ABCD-EFGH", "a-password-nobody-guessed")
                    .andExpect(status().isBadRequest());
        }

        // then
        redeemFrom("198.51.100.7", issued.code(), "a-password-nobody-guessed")
                .andExpect(status().isNoContent());
    }

    @Test
    void givenACodeAskedForAndRedeemed_whenTheLogIsRead_thenTheTwoMomentsAreTold() throws Exception {
        // given
        UUID account = account("doe.jane", "jane.doe@example.org");
        askForAPassword("doe.jane", "192.0.2.24").andExpect(status().isAccepted());

        // when
        assertThat(loggedSubjects("identity.account.passwordResetRequested"))
                .as("asked for and never redeemed is the distinction the old flow could not make")
                .containsExactly(account);
        assertThat(loggedSubjects("identity.account.passwordResetRedeemed")).isEmpty();

        // then — the mailed code is stored only as a hash, so redemption needs one this test holds
        redeem(codes.issueFor(account).code(), "a-password-nobody-guessed")
                .andExpect(status().isNoContent());
        assertThat(loggedSubjects("identity.account.passwordResetRedeemed")).containsExactly(account);
    }

    private List<UUID> loggedSubjects(String eventType) {
        return jdbc.sql("SELECT subject_id FROM domain_event WHERE event_type = :type")
                .param("type", eventType)
                .query(UUID.class).list();
    }

    // The instance reads its own clock, which the test fixes, so a window this test moves has to
    // move against that one rather than against the database's.
    private void expire(UUID account) {
        Instant now = clock.instant();
        int moved = jdbc.sql("""
                        UPDATE password_reset_token
                        SET created_at = :createdAt, expires_at = :expiresAt
                        WHERE account_id = :account
                        """)
                .param("createdAt", now.minus(Duration.ofHours(2)).atOffset(ZoneOffset.UTC))
                .param("expiresAt", now.minus(Duration.ofHours(1)).atOffset(ZoneOffset.UTC))
                .param("account", account)
                .update();
        assertThat(moved).isEqualTo(1);
    }

    private List<UUID> outstandingCodes() {
        return jdbc.sql("SELECT account_id FROM password_reset_token")
                .query(UUID.class).list();
    }

    private ResultActions redeem(String code, String password) throws Exception {
        return redeemFrom("192.0.2.30", code, password);
    }

    private ResultActions redeemFrom(String from, String code, String password) throws Exception {
        return ask("/api/account-recovery/password/redemption",
                "{\"code\":\"" + code + "\",\"password\":\"" + password + "\"}", from);
    }

    private int globalAttempts() {
        return jdbc.sql("SELECT attempt_count FROM login_attempt_limit WHERE scope = 'GLOBAL'")
                .query(Integer.class).optional().orElse(0);
    }

    private List<UUID> mailedCodes() {
        return jdbc.sql("""
                        SELECT account_id FROM message_record
                        WHERE kind = 'ACCOUNT_PASSWORD_RESET_CODE'
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
