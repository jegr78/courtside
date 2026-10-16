package org.courtside.dataexchange.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, NotificationTestFixture.class})
class LogExportAdminControllerTest extends AbstractIntegrationTest {

    private static final String AUDIT_HEADER =
            "occurredAt,eventType,subjectId,subjectName,actorAccountId,actorUsername,parameters";
    private static final String MESSAGE_HEADER =
            "queuedAt,settledAt,kind,state,messageId,personId,personName,reason,statusCode";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UserDetails member;
    private UUID administratorAccountId;
    private UUID memberAccountId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID adminPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        administratorAccountId = identity.createEnabledAccount(adminPersonId, "doe.jane", Set.of(Role.ADMIN));
        administrator = userDetailsService.loadUserByUsername("doe.jane");
        UUID memberPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        memberAccountId = identity.createEnabledAccount(memberPersonId, "roe.john", Set.of(Role.MEMBER));
        member = userDetailsService.loadUserByUsername("roe.john");
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenRecordedChanges_whenTheAuditLogIsExported_thenEveryEntryIsARowNewestFirst() throws Exception {
        // given
        UUID older = recordChange("test.change.older", minutesAgo(30));
        UUID newer = recordChange("test.change.newer", minutesAgo(10));

        // when
        String written = mockMvc.perform(post("/api/admin/export/audit").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv"))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"audit-log-2026-05-12.csv\""))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        List<String> lines = lines(written);
        assertThat(lines.getFirst()).as("UTF-8 opens with a byte order mark").isEqualTo("﻿" + AUDIT_HEADER);
        List<String> recorded = lines.stream().filter(line -> line.contains("test.change.")).toList();
        assertThat(recorded).as("newest first, one row per entry").hasSize(2);
        assertThat(recorded.getFirst()).contains("test.change.newer").contains(newer.toString());
        assertThat(recorded.getLast()).contains("test.change.older").contains(older.toString());
    }

    @Test
    void givenMoreEntriesThanOneReadHolds_whenTheAuditLogIsExported_thenEachEntryAppearsExactlyOnce()
            throws Exception {
        // given
        int entries = 1_234;
        List<Object[]> rows = new ArrayList<>();
        Instant start = minutesAgo(60 * 24);
        for (int index = 0; index < entries; index++) {
            rows.add(new Object[]{UUID.randomUUID(), "test.history.entry", UUID.randomUUID(),
                    Timestamp.from(start.plusSeconds(index)), "{\"index\":" + index + "}"});
        }
        jdbc.batchUpdate("""
                INSERT INTO domain_event (id, event_type, subject_id, occurred_at, payload)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, rows);

        // when
        String written = mockMvc.perform(post("/api/admin/export/audit").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        List<Integer> indices = lines(written).stream()
                .filter(line -> line.contains("test.history.entry"))
                .map(line -> Integer.parseInt(line.replaceAll(".*index\"\"?:(\\d+).*", "$1")))
                .toList();
        assertThat(indices).as("every entry once, newest first, across every read the export made")
                .hasSize(entries)
                .isSortedAccordingTo((left, right) -> Integer.compare(right, left))
                .doesNotHaveDuplicates();
    }

    @Test
    void givenAnEntryAValueOfWhichOpensAFormula_whenTheAuditLogIsExported_thenTheCellIsNeutralised()
            throws Exception {
        // given
        recordChange("=HYPERLINK(\"http://example.org\")", minutesAgo(5));

        // when
        String written = mockMvc.perform(post("/api/admin/export/audit").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        assertThat(written).as("a spreadsheet must read the cell as text")
                .contains("\"'=HYPERLINK(\"\"http://example.org\"\")\"")
                .doesNotContain(",=HYPERLINK");
    }

    @Test
    void givenAChosenSeparatorAndCharacterSet_whenTheAuditLogIsExported_thenTheFileUsesBoth() throws Exception {
        // given
        recordChange("test.change.encoded", minutesAgo(5));
        Charset windows1252 = Charset.forName("windows-1252");

        // when
        byte[] written = mockMvc.perform(post("/api/admin/export/audit")
                        .param("separator", ";").param("encoding", "windows-1252")
                        .with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv"))
                .andReturn().getResponse().getContentAsByteArray();

        // then
        String text = new String(written, windows1252);
        assertThat(text).as("no byte order mark outside UTF-8")
                .startsWith(AUDIT_HEADER.replace(',', ';'));
        assertThat(text).contains(";test.change.encoded;");
    }

    @Test
    void givenAPeriod_whenTheAuditLogIsExported_thenOnlyItsDaysAreInTheFile() throws Exception {
        // given
        recordChange("test.change.yesterday", Instant.parse("2026-05-11T09:00:00Z"));
        recordChange("test.change.lastWeek", Instant.parse("2026-05-04T09:00:00Z"));

        // when
        String written = mockMvc.perform(post("/api/admin/export/audit")
                        .param("from", "2026-05-10").param("to", "2026-05-11")
                        .with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        assertThat(written).contains("test.change.yesterday").doesNotContain("test.change.lastWeek");
    }

    @Test
    void givenAPeriodWhoseEndComesBeforeItsStart_whenTheAuditLogIsExported_thenItIsRefused() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/audit")
                        .param("from", "2026-05-11").param("to", "2026-05-10")
                        .with(csrf()).with(user(administrator)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("export.period.endsBeforeItStarts"));
    }

    @Test
    void givenAnExport_whenItIsAnswered_thenTheLogRecordsItForTheWholeInstanceAndLeavesItOutOfTheFile()
            throws Exception {
        // when
        String written = mockMvc.perform(post("/api/admin/export/audit").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        List<Map<String, Object>> recorded = jdbc.queryForList("""
                SELECT subject_id, actor_account_id, payload->>'log' AS log FROM domain_event
                WHERE event_type = 'dataexchange.log.exported'
                """);
        assertThat(recorded).as("one entry, about no single subject, made by the administrator").hasSize(1);
        assertThat(recorded.getFirst().get("subject_id")).isNull();
        assertThat(recorded.getFirst().get("actor_account_id")).isEqualTo(administratorAccountId);
        assertThat(recorded.getFirst().get("log")).isEqualTo("audit");
        assertThat(written).as("the file ends before the export recorded itself")
                .doesNotContain("dataexchange.log.exported");
    }

    @Test
    void givenAMember_whenTheyAskForEitherLog_thenTheyAreRefusedAndNothingIsRecorded() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/audit").with(csrf()).with(user(member)))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/export/messages").with(csrf()).with(user(member)))
                .andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM domain_event WHERE event_type = 'dataexchange.log.exported'", Long.class))
                .isZero();
    }

    @Test
    void givenNobodySignedIn_whenTheAuditLogIsAskedFor_thenTheAnswerIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/audit").with(csrf()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenNoCsrfToken_whenAnAdministratorAsksForTheMessageLog_thenTheRequestIsRefused() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/messages").with(user(administrator)))
                .andExpect(status().isForbidden());
    }

    @Test
    void givenSentMessages_whenTheMessageLogIsExported_thenEachIsARowNamingThePersonAndWhatBecameOfIt()
            throws Exception {
        // given
        notifications.recordHandedOver(memberAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT,
                "<handed@example.org>", minutesAgo(20));
        notifications.recordRefused(memberAccountId, MessageKind.CREDENTIALS_PASSWORD_RESET,
                "=1+1", minutesAgo(10), "SMTPAddressFailedException", "550");

        // when
        String written = mockMvc.perform(post("/api/admin/export/messages").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"message-log-2026-05-12.csv\""))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        List<String> lines = lines(written);
        assertThat(lines.getFirst()).isEqualTo("﻿" + MESSAGE_HEADER);
        assertThat(lines).hasSize(3);
        assertThat(lines.get(1)).as("newest first, with the reason and the relay's code")
                .contains("CREDENTIALS_PASSWORD_RESET,REFUSED,'=1+1,")
                .contains("John Roe").endsWith("SMTPAddressFailedException,550");
        assertThat(lines.get(2)).contains("CREDENTIALS_NEW_ACCOUNT,HANDED_OVER,<handed@example.org>");
    }

    @Test
    void givenMoreMessagesThanOneReadHolds_whenTheMessageLogIsExported_thenEachAppearsExactlyOnce()
            throws Exception {
        // given
        int messages = 640;
        for (int index = 0; index < messages; index++) {
            notifications.recordHandedOver(memberAccountId, MessageKind.CREDENTIALS_NEW_ACCOUNT,
                    "<message-" + index + "@example.org>", minutesAgo(60 * 24).plusSeconds(index));
        }

        // when
        String written = mockMvc.perform(post("/api/admin/export/messages").with(csrf()).with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        List<String> ids = lines(written).stream().skip(1)
                .map(line -> line.replaceAll(".*<message-(\\d+)@.*", "$1"))
                .toList();
        assertThat(ids).as("every message once across every read the export made")
                .hasSize(messages).doesNotHaveDuplicates();
    }

    private UUID recordChange(String eventType, Instant at) {
        UUID subjectId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO domain_event (id, event_type, subject_id, occurred_at, payload)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, UUID.randomUUID(), eventType, subjectId, Timestamp.from(at), "{}");
        return subjectId;
    }

    private Instant minutesAgo(long minutes) {
        return clock.instant().minusSeconds(minutes * 60);
    }

    private static List<String> lines(String written) {
        return Arrays.stream(written.split("\r\n")).filter(line -> !line.isEmpty()).toList();
    }
}
