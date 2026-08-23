package org.courtside.notification.internal;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class MessageAdminControllerTest extends AbstractIntegrationTest {

    private static final int MAX_PAGES = 10;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MessageRecordRepository records;

    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UUID janesAccountId;
    private UUID janesPersonId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        janesPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janesAccountId = identity.createEnabledAccount(janesPersonId, "doe.jane", Set.of(Role.ADMIN));
        administrator = userDetailsService.loadUserByUsername("doe.jane");
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenAMessageWasQueued_whenTheLogIsRead_thenTheEntryNamesThePersonItWasWrittenTo()
            throws Exception {
        // given
        UUID recordId = queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "a-message-id");

        // when / then
        mockMvc.perform(get("/api/admin/messages").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)))
                .andExpect(jsonPath("$.entries[0].id").value(recordId.toString()))
                .andExpect(jsonPath("$.entries[0].kind").value("CREDENTIALS_NEW_ACCOUNT"))
                .andExpect(jsonPath("$.entries[0].state").value("QUEUED"))
                .andExpect(jsonPath("$.entries[0].messageId").value("a-message-id"))
                .andExpect(jsonPath("$.entries[0].settledAt").doesNotExist())
                .andExpect(jsonPath("$.entries[0].personId").value(janesPersonId.toString()))
                .andExpect(jsonPath("$.entries[0].personName").value("Jane Doe"));
    }

    @Test
    void givenARefusedMessage_whenTheLogIsRead_thenItCarriesWhatTheRelayAnswered() throws Exception {
        // given
        UUID recordId = queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "a-message-id");
        refuse(recordId, "SendFailedException", "550");

        // when / then
        mockMvc.perform(get("/api/admin/messages").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].state").value("REFUSED"))
                .andExpect(jsonPath("$.entries[0].reason").value("SendFailedException"))
                .andExpect(jsonPath("$.entries[0].statusCode").value("550"))
                .andExpect(jsonPath("$.entries[0].settledAt").exists());
    }

    @Test
    void givenAMessageInEveryState_whenOneStateIsAsked_thenOnlyThatStateIsOnThePage() throws Exception {
        // given
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "queued-message");
        handOver(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "handed-over-message"));
        refuse(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "refused-message"),
                "SendFailedException", "550");
        fail(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "failed-message"),
                "MailConnectException");

        // when / then
        mockMvc.perform(get("/api/admin/messages").param("state", "FAILED").with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)))
                .andExpect(jsonPath("$.entries[0].messageId").value("failed-message"));
    }

    @Test
    void givenAMessageInEveryState_whenOnlyTheUnsettledAreAsked_thenBothWaysOfFailingAreOnThePage()
            throws Exception {
        // given
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "queued-message");
        handOver(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "handed-over-message"));
        refuse(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "refused-message"),
                "SendFailedException", "550");
        fail(queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "failed-message"),
                "MailConnectException");

        // when
        String body = mockMvc.perform(get("/api/admin/messages")
                        .param("unsettled", "true").with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(JsonPath.<List<String>>read(body, "$.entries[*].messageId"))
                .containsExactlyInAnyOrder("refused-message", "failed-message");
    }

    @Test
    void givenAStateThisInstanceDoesNotKnow_whenTheLogIsRead_thenItIsRefused() throws Exception {
        // when / then — a filter nobody can satisfy must not read as a log with nothing in it
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "a-message-id");
        mockMvc.perform(get("/api/admin/messages").param("state", "DELIVERED").with(user(administrator)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("request.parameterTypeMismatch"));
    }

    @Test
    void givenTwoPeopleWereWrittenTo_whenOneOfThemIsAsked_thenOnlyTheirMessagesAreOnThePage()
            throws Exception {
        // given
        UUID otherPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID otherAccountId = identity.createEnabledAccount(otherPersonId, "roe.john", Set.of(Role.MEMBER));
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "to-jane");
        queued(otherAccountId, MessageKind.CREDENTIALS_PASSWORD_RESET, "to-john");

        // when / then
        mockMvc.perform(get("/api/admin/messages")
                        .param("personId", otherPersonId.toString()).with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)))
                .andExpect(jsonPath("$.entries[0].messageId").value("to-john"))
                .andExpect(jsonPath("$.entries[0].personName").value("John Roe"));
    }

    @Test
    void givenAPersonWhoHasNoAccount_whenTheirMessagesAreAsked_thenThePageIsEmpty() throws Exception {
        // given
        UUID withoutAccount = identity.createPerson("Mary", "Major", "mary.major@example.org");
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "to-jane");

        // when / then
        mockMvc.perform(get("/api/admin/messages")
                        .param("personId", withoutAccount.toString()).with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(0)));
    }

    @Test
    void givenMessagesQueuedOnDifferentDays_whenAWindowIsAsked_thenOnlyWhatFallsInsideItIsOnThePage()
            throws Exception {
        // given
        Instant now = clock.instant();
        queuedAt(janesAccountId, "the-day-before", now.minus(1, ChronoUnit.DAYS));
        queuedAt(janesAccountId, "inside-the-window", now);
        queuedAt(janesAccountId, "the-day-after", now.plus(1, ChronoUnit.DAYS));

        // when / then
        mockMvc.perform(get("/api/admin/messages")
                        .param("from", now.toString())
                        .param("to", now.plus(1, ChronoUnit.HOURS).toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)))
                .andExpect(jsonPath("$.entries[0].messageId").value("inside-the-window"));
    }

    @Test
    void givenMoreMessagesThanOnePageHolds_whenTheCursorIsFollowed_thenEachIsSeenExactlyOnce()
            throws Exception {
        // given — one instant for all of them, so only the total order keeps the boundary honest
        for (int index = 0; index < 5; index++) {
            queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "message-" + index);
        }

        // when
        List<String> seen = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            MockHttpServletRequestBuilder request = get("/api/admin/messages")
                    .param("limit", "2")
                    .with(user(administrator));
            if (cursor != null) {
                request.param("cursor", cursor);
            }
            String body = mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            seen.addAll(JsonPath.read(body, "$.entries[*].messageId"));
            cursor = JsonPath.read(body, "$.nextCursor");
            if (cursor == null) {
                break;
            }
        }

        // then
        assertThat(seen).hasSize(5).doesNotHaveDuplicates();
        assertThat(cursor).isNull();
    }

    @Test
    void givenACursorNamingNoEntry_whenTheLogIsRead_thenItIsRefusedRatherThanStartedOver()
            throws Exception {
        // given
        queued(janesAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, "a-message-id");

        // when / then
        mockMvc.perform(get("/api/admin/messages")
                        .param("cursor", UUID.randomUUID().toString()).with(user(administrator)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:message-cursor-unknown"))
                .andExpect(jsonPath("$.violations[0].code").value("message.cursor.unknown"));
    }

    @Test
    void givenARoleThatIsNotAdministration_whenTheLogIsRead_thenItIsRefused() throws Exception {
        // given — who was written to and when is personal data, and no officer role needs it
        for (Role role : Role.values()) {
            if (role == Role.ADMIN) {
                continue;
            }
            String username = role.name().toLowerCase(Locale.ROOT) + ".holder";
            UUID personId = identity.createPerson("John", "Roe", username + "@example.org");
            identity.createEnabledAccount(personId, username, Set.of(role));

            // when / then
            mockMvc.perform(get("/api/admin/messages")
                            .with(user(userDetailsService.loadUserByUsername(username))))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        }
    }

    private UUID queued(UUID accountId, MessageKind kind, String messageId) {
        return records.save(new MessageRecord(accountId, kind, messageId, clock.instant())).getId();
    }

    private void queuedAt(UUID accountId, String messageId, Instant at) {
        records.save(new MessageRecord(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, messageId, at));
    }

    private void handOver(UUID recordId) {
        settle(recordId, record -> record.handedOver(clock.instant()));
    }

    private void refuse(UUID recordId, String reason, String statusCode) {
        settle(recordId, record -> record.refused(clock.instant(), reason, statusCode));
    }

    private void fail(UUID recordId, String reason) {
        settle(recordId, record -> record.failed(clock.instant(), reason));
    }

    private void settle(UUID recordId, Consumer<MessageRecord> settlement) {
        MessageRecord record = records.findById(recordId).orElseThrow();
        settlement.accept(record);
        records.save(record);
    }
}
