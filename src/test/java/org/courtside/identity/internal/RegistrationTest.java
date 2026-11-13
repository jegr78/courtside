package org.courtside.identity.internal;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.RosterService;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import jakarta.mail.internet.MimeMessage;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.atLeast;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "courtside.login-protection.registration.max-failures=3",
        "courtside.login-protection.address.max-failures=3"})
class RegistrationTest extends AbstractIntegrationTest {

    private static final String STRONG = "Carefully chosen court phrase 47";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private NotificationTestFixture notifications;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private RegistrationService registrations;
    @Autowired
    private RosterService roster;
    @Autowired
    private TransactionTemplate transactions;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private Clock clock;
    private MockMvc mockMvc;

    @BeforeEach
    void anInstanceAdmittingExternalBookings() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        config.admitExternalBookings(true);
    }

    @Test
    void givenExternalBookingsAdmitted_whenSomebodyRegisters_thenADisabledExternalAccountWaitsForItsVerificationMail()
            throws Exception {
        // when
        MockHttpServletResponse response = register("roe.john", "john.roe@example.org", "10.0.0.1");

        // then
        assertThat(response.getStatus()).isEqualTo(202);
        UserAccount account = accounts.findByUsername("roe.john").orElseThrow();
        assertThat(account.isEnabled()).as("no sign-in before the address is verified").isFalse();
        assertThat(account.getRoles()).containsExactly(Role.EXTERNAL);
        assertThat(notifications.mailsQueuedFor(account.getId())).containsExactly(MessageKind.REGISTRATION_VERIFICATION);
        assertThat(bodyMailedTo("john.roe@example.org")).as("the mail carries a link the registrant can open")
                .contains("https://courts.example.org/registration/verify#");
    }

    @Test
    void givenANameCarryingAnAddress_whenSomebodyRegistersAStrangersMailbox_thenTheMailRepeatsNothingTheyTyped()
            throws Exception {
        // when
        mockMvc.perform(post("/api/registration").with(csrf())
                .with(request -> { request.setRemoteAddr("10.0.0.1"); return request; })
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"firstName":"Claim at prize.example.org","lastName":"Roe","username":"roe.john",
                        "password":"%s","email":"john.roe@example.org","language":"en"}""".formatted(STRONG)));

        // then
        assertThat(bodyMailedTo("john.roe@example.org")).as("a club mail to an unverified address carries no typed text")
                .doesNotContain("prize.example.org");
    }

    @Test
    void givenAMailedCode_whenItIsUsedTwice_thenTheFirstUseActivatesTheAccountAndTheSecondIsRefused() throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UUID account = accounts.findByUsername("roe.john").orElseThrow().getId();
        String code = codeMailedTo("john.roe@example.org");

        // when
        MockHttpServletResponse first = verify(code);
        MockHttpServletResponse second = verify(code);

        // then
        assertThat(first.getStatus()).isEqualTo(204);
        assertThat(accounts.findById(account).orElseThrow().isEnabled()).isTrue();
        assertThat(jdbc.sql("SELECT subject_id FROM domain_event WHERE event_type = 'identity.registration.verified'")
                .query(UUID.class).list()).as("the audit log names the account the code switched on")
                .containsExactly(account);
        assertThat(second.getStatus()).isEqualTo(400);
        assertThat(typeOf(second)).isEqualTo("urn:courtside:error:registration-code-invalid");
    }

    @Test
    void givenAnAddressGuessingCodes_whenItGuessesPastTheBudget_thenItIsRefusedWhileTheRightfulHolderStillVerifies()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        String code = codeMailedTo("john.roe@example.org");
        for (int guess = 0; guess < 3; guess++) {
            assertThat(verifyFrom("203.0.113.9", "ABCD-EFGH").getStatus()).isEqualTo(400);
        }

        // when
        MockHttpServletResponse guessing = verifyFrom("203.0.113.9", "ABCD-EFGJ");
        MockHttpServletResponse rightful = verifyFrom("198.51.100.7", code);

        // then
        assertThat(guessing.getStatus()).isEqualTo(429);
        assertThat(typeOf(guessing)).isEqualTo("urn:courtside:error:password-verification-rate-limited");
        assertThat(rightful.getStatus()).as("only the guessing address is held back").isEqualTo(204);
    }

    @Test
    void givenExternalBookingsSwitchedOffAfterRegistering_whenTheMailedCodeIsUsed_thenItIsRefusedAndTheAccountStaysDisabled()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UUID account = accounts.findByUsername("roe.john").orElseThrow().getId();
        String code = codeMailedTo("john.roe@example.org");
        config.admitExternalBookings(false);

        // when
        MockHttpServletResponse refused = verify(code);

        // then
        assertThat(refused.getStatus()).isEqualTo(404);
        assertThat(typeOf(refused)).isEqualTo("urn:courtside:error:registration-closed");
        assertThat(accounts.findById(account).orElseThrow().isEnabled()).isFalse();
    }

    @Test
    void givenTheBoardDisabledAPendingRegistration_whenTheMailedCodeIsUsed_thenItIsRefusedAndTheAccountStaysDisabled()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UUID account = accounts.findByUsername("roe.john").orElseThrow().getId();
        String code = codeMailedTo("john.roe@example.org");
        identity.disableAccount(account);

        // when
        MockHttpServletResponse refused = verify(code);

        // then
        assertThat(refused.getStatus()).isEqualTo(400);
        assertThat(typeOf(refused)).isEqualTo("urn:courtside:error:registration-code-invalid");
        assertThat(accounts.findById(account).orElseThrow().isEnabled())
                .as("a mailed link does not overrule the board").isFalse();
    }

    @Test
    void givenACodeWhoseRegistrationExpired_whenItIsUsed_thenItIsRefusedAsExpiredAndTheAccountStaysDisabled()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UUID account = accounts.findByUsername("roe.john").orElseThrow().getId();
        String code = codeMailedTo("john.roe@example.org");
        expire(account);

        // when
        MockHttpServletResponse response = verify(code);

        // then
        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(typeOf(response)).isEqualTo("urn:courtside:error:registration-code-expired");
        assertThat(accounts.findById(account).orElseThrow().isEnabled()).isFalse();
    }

    @Test
    void givenATakenUsername_whenSomebodyRegistersWithIt_thenTheAnswerMatchesAndOnlyAMailToTheSubmittedAddressFollows()
            throws Exception {
        // given
        UUID holder = identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", Set.of(Role.MEMBER));
        long people = jdbc.sql("SELECT count(*) FROM person").query(Long.class).single();
        MockHttpServletResponse fresh = register("roe.john", "john.roe@example.org", "10.0.0.1");

        // when
        MockHttpServletResponse taken = register("doe.jane", "mary.major@example.org", "10.0.0.2");

        // then
        assertThat(taken.getStatus()).isEqualTo(fresh.getStatus());
        assertThat(taken.getContentAsString()).isEqualTo(fresh.getContentAsString());
        assertThat(taken.getHeaderNames()).isEqualTo(fresh.getHeaderNames());
        assertThat(jdbc.sql("SELECT count(*) FROM person").query(Long.class).single())
                .as("only the fresh registration created a person").isEqualTo(people + 1);
        assertThat(notifications.mailsQueuedFor(holder)).containsExactly(MessageKind.REGISTRATION_NAME_TAKEN);
        assertThat(recipients()).as("the submitted address learns of the taken name, its holder hears nothing")
                .contains("mary.major@example.org").doesNotContain("jane.doe@example.org");
        assertThat(accounts.findById(holder).orElseThrow().getPerson().getEmail()).isEqualTo("jane.doe@example.org");
    }

    @Test
    void givenOneClientAddress_whenItRegistersPastItsBudget_thenTheNextRegistrationIsRefusedWithRetryAfter()
            throws Exception {
        // given
        for (int index = 1; index <= 3; index++) {
            assertThat(register("roe.john" + index, "john.roe" + index + "@example.org", "10.0.0.9").getStatus()).isEqualTo(202);
        }

        // when
        MockHttpServletResponse refused = register("roe.john4", "john.roe4@example.org", "10.0.0.9");
        MockHttpServletResponse elsewhere = register("roe.john5", "john.roe5@example.org", "10.0.0.10");

        // then
        assertThat(refused.getStatus()).isEqualTo(429);
        assertThat(typeOf(refused)).isEqualTo("urn:courtside:error:registration-rate-limited");
        assertThat(refused.getHeader("Retry-After")).isNotBlank();
        assertThat(accounts.findByUsername("roe.john4")).isEmpty();
        assertThat(elsewhere.getStatus()).as("the budget belongs to one client address").isEqualTo(202);
    }

    @Test
    void givenOneRecipient_whenRegistrationsFromManyClientsNameItPastItsBudget_thenTheNextIsRefused()
            throws Exception {
        // given
        for (int index = 1; index <= 3; index++) {
            assertThat(register("roe.john" + index, "john.roe@example.org", "10.0.1." + index).getStatus())
                    .isEqualTo(202);
        }

        // when
        MockHttpServletResponse refused = register("roe.john4", "John.Roe@example.org", "10.0.1.4");

        // then
        assertThat(refused.getStatus()).as("one mailbox is not mailed without bound").isEqualTo(429);
        assertThat(typeOf(refused)).isEqualTo("urn:courtside:error:registration-rate-limited");
        assertThat(accounts.findByUsername("roe.john4")).isEmpty();
    }

    @Test
    void givenExternalBookingsSwitchedOff_whenSomebodyRegisters_thenRegistrationIsClosedAndNothingIsCreated()
            throws Exception {
        // given
        config.admitExternalBookings(false);

        // when
        MockHttpServletResponse response = register("roe.john", "john.roe@example.org", "10.0.0.1");

        // then
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(typeOf(response)).isEqualTo("urn:courtside:error:registration-closed");
        assertThat(accounts.findByUsername("roe.john")).isEmpty();
    }

    @Test
    void givenAGuessablePassword_whenSomebodyRegisters_thenThePasswordIsRefusedAndNothingIsCreated() throws Exception {
        // when
        MockHttpServletResponse response = mockMvc.perform(post("/api/registration").with(csrf())
                .with(request -> { request.setRemoteAddr("10.0.0.1"); return request; })
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("roe.john", "roe.john.roe.john", "john.roe@example.org"))).andReturn().getResponse();

        // then
        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(typeOf(response)).isEqualTo("urn:courtside:error:password-too-guessable");
        assertThat(accounts.findByUsername("roe.john")).isEmpty();
    }

    @Test
    void givenAGuessablePassword_whenTheUsernameIsTakenOrFree_thenBothAnswersRefuseThePasswordAlike() throws Exception {
        // given
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"), "doe.jane",
                Set.of(Role.MEMBER));

        // when
        MockHttpServletResponse taken = registerWithPassword("doe.jane", "doe.jane.doe.jane", "10.0.0.3");
        MockHttpServletResponse free = registerWithPassword("roe.john", "roe.john.roe.john", "10.0.0.4");

        // then
        assertThat(taken.getStatus()).as("a refused password must not tell a taken name from a free one")
                .isEqualTo(free.getStatus()).isEqualTo(400);
        assertThat(typeOf(taken)).isEqualTo(typeOf(free)).isEqualTo("urn:courtside:error:password-too-guessable");
    }

    @Test
    void givenAnUnverifiedAndAVerifiedRegistration_whenTheCleanupRunsAfterTheirWindow_thenOnlyTheUnverifiedOneIsGone()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        register("major.mary", "mary.major@example.org", "10.0.0.2");
        UUID unverified = accounts.findByUsername("roe.john").orElseThrow().getId();
        UUID personOfUnverified = accounts.findById(unverified).orElseThrow().getPerson().getId();
        UUID verified = accounts.findByUsername("major.mary").orElseThrow().getId();
        verify(codeMailedTo("mary.major@example.org"));
        expire(unverified);

        // when
        int removed = registrations.deleteExpired();

        // then
        assertThat(removed).isOne();
        assertThat(accounts.findById(unverified)).isEmpty();
        assertThat(jdbc.sql("SELECT count(*) FROM person WHERE id = :id").param("id", personOfUnverified)
                .query(Long.class).single()).as("the person goes with its account").isZero();
        assertThat(accounts.findById(verified)).map(UserAccount::isEnabled).contains(true);
    }

    @Test
    void givenExpiredRegistrationsTheBoardAlreadyActedOn_whenTheCleanupRuns_thenTheirAccountsStayAndTheRestIsSwept()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        register("major.mary", "mary.major@example.org", "10.0.0.2");
        register("miles.richard", "richard.miles@example.org", "10.0.0.3");
        UUID enabledByBoard = accounts.findByUsername("roe.john").orElseThrow().getId();
        UUID referenced = accounts.findByUsername("major.mary").orElseThrow().getId();
        UUID abandoned = accounts.findByUsername("miles.richard").orElseThrow().getId();
        jdbc.sql("UPDATE user_account SET enabled = true WHERE id = :id").param("id", enabledByBoard).update();
        jdbc.sql("""
                        INSERT INTO guardian_relationship (id, guardian_person_id, dependant_person_id, started_on)
                        SELECT gen_random_uuid(), guardian.person_id, dependant.person_id, DATE '2026-05-01'
                        FROM user_account guardian, user_account dependant
                        WHERE guardian.id = :guardian AND dependant.id = :dependant
                        """)
                .param("guardian", enabledByBoard).param("dependant", referenced).update();
        expire(enabledByBoard);
        expire(referenced);
        expire(abandoned);

        // when
        int removed = registrations.deleteExpired();

        // then
        assertThat(removed).as("only the registration nobody touched is swept").isOne();
        assertThat(accounts.findById(abandoned)).isEmpty();
        assertThat(accounts.findById(enabledByBoard)).as("an account the board switched on stays")
                .map(UserAccount::isEnabled).contains(true);
        assertThat(accounts.findById(referenced)).as("a person other records refer to stays").isPresent();
        assertThat(jdbc.sql("SELECT count(*) FROM registration_verification").query(Long.class).single())
                .as("an expired verification never outlives the sweep").isZero();
    }

    @Test
    void givenTheBoardCorrectedThePendingAddress_whenTheOldLinkIsUsed_thenItIsRefusedAndTheCorrectedAddressVerifies()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UserAccount registered = accounts.findByUsername("roe.john").orElseThrow();
        String oldCode = codeMailedTo("john.roe@example.org");
        roster.changePerson(registered.getPerson().getId(), "John", "Roe", "john.roe@example.net");

        // when
        MockHttpServletResponse refused = verify(oldCode);

        // then
        assertThat(refused.getStatus()).isEqualTo(400);
        assertThat(typeOf(refused)).as("the link mailed to the mistyped address is withdrawn")
                .isEqualTo("urn:courtside:error:registration-code-invalid");
        assertThat(accounts.findById(registered.getId()).orElseThrow().isEnabled()).isFalse();
        assertThat(verify(codeMailedTo("john.roe@example.net")).getStatus())
                .as("the corrected address receives a link of its own").isEqualTo(204);
        assertThat(accounts.findById(registered.getId()).orElseThrow().isEnabled()).isTrue();
    }

    @Test
    void givenTheBoardCorrectingThePendingAddress_whenTheOldLinkArrivesBeforeTheFreshMailLeaves_thenItIsAlreadyRefused()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        UUID person = accounts.findByUsername("roe.john").orElseThrow().getPerson().getId();
        String oldCode = codeMailedTo("john.roe@example.org");

        // when / then
        transactions.executeWithoutResult(status -> {
            roster.changePerson(person, "John", "Roe", "john.roe@example.net");
            assertThatThrownBy(() -> registrations.verify(oldCode))
                    .as("the correction itself withdraws the link, not the next mail")
                    .isInstanceOfSatisfying(RegistrationCodeInvalidException.class, refused ->
                            assertThat(refused.getCode()).isEqualTo("identity.registration.codeInvalid"));
            status.setRollbackOnly();
        });
    }

    @Test
    void givenExpiredRegistrationsTheBoardChangedWhileDisabled_whenTheCleanupRuns_thenOnlyTheUntouchedOneIsSwept()
            throws Exception {
        // given
        register("roe.john", "john.roe@example.org", "10.0.0.1");
        register("major.mary", "mary.major@example.org", "10.0.0.2");
        register("miles.richard", "richard.miles@example.org", "10.0.0.3");
        UserAccount toggled = accounts.findByUsername("roe.john").orElseThrow();
        UserAccount promoted = accounts.findByUsername("major.mary").orElseThrow();
        UUID abandoned = accounts.findByUsername("miles.richard").orElseThrow().getId();
        roster.setAccountEnabled(toggled.getPerson().getId(), true);
        roster.setAccountEnabled(toggled.getPerson().getId(), false);
        roster.changeRoles(promoted.getPerson().getId(), Set.of(Role.EXTERNAL, Role.MEMBER));
        expire(toggled.getId());
        expire(promoted.getId());
        expire(abandoned);

        // when
        int removed = registrations.deleteExpired();

        // then
        assertThat(removed).as("only the registration nobody touched is swept").isOne();
        assertThat(accounts.findById(abandoned)).isEmpty();
        assertThat(accounts.findById(toggled.getId())).as("an account the board switched on and off stays").isPresent();
        assertThat(accounts.findById(promoted.getId())).as("an account the board gave a role stays").isPresent();
    }

    @Test
    void givenTheAnonymisedPrefix_whenSomebodyRegistersWithIt_thenTheNameIsRefusedAsReservedAndNothingIsCreated()
            throws Exception {
        // when
        MockHttpServletResponse response = register("anonymised-roe.john", "john.roe@example.org", "10.0.0.1");

        // then
        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(typeOf(response)).isEqualTo("urn:courtside:error:username-reserved");
        assertThat(accounts.findByUsername("anonymised-roe.john")).isEmpty();
    }

    private MockHttpServletResponse register(String username, String email, String address) throws Exception {
        return mockMvc.perform(post("/api/registration").with(csrf())
                        .with(request -> { request.setRemoteAddr(address); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(username, STRONG, email)))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse registerWithPassword(String username, String password, String address)
            throws Exception {
        return mockMvc.perform(post("/api/registration").with(csrf())
                        .with(request -> { request.setRemoteAddr(address); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(username, password, "john.roe@example.org")))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse verifyFrom(String address, String code) throws Exception {
        return mockMvc.perform(post("/api/registration/verification").with(csrf())
                        .with(request -> { request.setRemoteAddr(address); return request; })
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse verify(String code) throws Exception {
        return mockMvc.perform(post("/api/registration/verification").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse();
    }

    private static String body(String username, String password, String email) {
        return """
                {"firstName":"John","lastName":"Roe","username":"%s","password":"%s","email":"%s","language":"en"}
                """.formatted(username, password, email);
    }

    private static String typeOf(MockHttpServletResponse response) throws Exception {
        return JsonPath.read(response.getContentAsString(), "$.type");
    }

    private List<MimeMessage> sent() {
        ArgumentCaptor<MimeMessage> messages = ArgumentCaptor.forClass(MimeMessage.class);
        org.mockito.Mockito.verify(sender, atLeast(0)).send(messages.capture());
        return messages.getAllValues();
    }

    private List<String> recipients() throws Exception {
        List<String> recipients = new java.util.ArrayList<>();
        for (MimeMessage message : sent()) {
            recipients.add(message.getAllRecipients()[0].toString());
        }
        return recipients;
    }

    private String bodyMailedTo(String address) throws Exception {
        for (MimeMessage message : sent()) {
            if (message.getAllRecipients()[0].toString().equals(address)) {
                return message.getContent().toString();
            }
        }
        throw new AssertionError("no message was mailed to " + address);
    }

    private String codeMailedTo(String address) throws Exception {
        Matcher link = Pattern.compile("registration/verify#(\\S+)").matcher(bodyMailedTo(address));
        assertThat(link.find()).as("the verification mail carries its link").isTrue();
        return link.group(1);
    }

    private void expire(UUID account) {
        jdbc.sql("UPDATE registration_verification SET created_at = :created, expires_at = :expired WHERE account_id = :id")
                .param("created", clock.instant().minus(Duration.ofHours(30)).atOffset(java.time.ZoneOffset.UTC))
                .param("expired", clock.instant().minus(Duration.ofHours(6)).atOffset(java.time.ZoneOffset.UTC))
                .param("id", account).update();
    }
}
