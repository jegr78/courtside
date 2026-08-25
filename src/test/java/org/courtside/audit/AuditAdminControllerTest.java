package org.courtside.audit;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({CardTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class})
class AuditAdminControllerTest extends AbstractIntegrationTest {

    private static final int MAX_PAGES = 10;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private Clock clock;

    @Autowired
    private JdbcTemplate jdbc;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UserDetails member;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        UUID adminPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        identity.createEnabledAccount(adminPersonId, "doe.jane", Set.of(Role.ADMIN));
        administrator = userDetailsService.loadUserByUsername("doe.jane");

        UUID memberPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(memberPersonId, "roe.john", Set.of(Role.MEMBER));
        member = userDetailsService.loadUserByUsername("roe.john");
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    void givenAChangeByAnAdministrator_whenTheLogIsRead_thenTheEntryNamesTheActorAndTheSubject()
            throws Exception {
        // given
        identity.signInAs("doe.jane");
        UUID courtId = facilityFixture.createCourt(7, "Centre Court");
        identity.signOut();

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].eventType").value("facility.court.added"))
                .andExpect(jsonPath("$.entries[0].subjectName").value("Centre Court"))
                .andExpect(jsonPath("$.entries[0].actorUsername").value("doe.jane"))
                .andExpect(jsonPath("$.entries[0].parameters.number").value(7));
    }

    @Test
    void givenAMember_whenTheLogIsRead_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/audit").with(user(member)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenNoAccountSignedIn_whenTheChangeIsRecorded_thenTheLogNamesNoActor() throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(3, "Court 3");

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].actorAccountId").doesNotExist())
                .andExpect(jsonPath("$.entries[0].actorUsername").doesNotExist());
    }

    @Test
    void givenACourtWithNoName_whenTheLogIsRead_thenTheSubjectNameFallsBackToItsNumber()
            throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(11, null);

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].subjectId").value(courtId.toString()))
                .andExpect(jsonPath("$.entries[0].subjectName").value("11"));
    }

    @Test
    void givenARecordedEventWithANullableValue_whenTheLogIsRead_thenNullRemainsPartOfThePayload()
            throws Exception {
        // given
        UUID cardId = cards.createUnlimitedParticipantCard("Unlimited guests");

        // when
        String body = mockMvc.perform(get("/api/admin/audit").param("subjectId", cardId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].eventType").value("card.participantCard.added"))
                .andReturn().getResponse().getContentAsString();

        // then
        Map<String, Object> parameters = JsonPath.read(body, "$.entries[0].parameters");
        assertThat(parameters).containsEntry("capacity", null);
    }

    @Test
    void givenAStoredEntryWithANestedNull_whenTheLogIsRead_thenTheNestedValueRemainsReadable()
            throws Exception {
        // given
        UUID eventId = UUID.randomUUID();
        UUID subjectId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO domain_event (id, event_type, subject_id, occurred_at, payload)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, eventId, "audit.nullable.recorded", subjectId, Timestamp.from(clock.instant()),
                "{\"nested\":{\"value\":null},\"retained\":\"present\"}");

        // when
        String body = mockMvc.perform(get("/api/admin/audit").param("subjectId", subjectId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].eventType").value("audit.nullable.recorded"))
                .andReturn().getResponse().getContentAsString();

        // then
        Map<String, Object> parameters = JsonPath.read(body, "$.entries[0].parameters");
        assertThat(parameters).containsEntry("retained", "present");
        Map<String, Object> nested = JsonPath.read(body, "$.entries[0].parameters.nested");
        assertThat(nested).containsEntry("value", null);
    }

    @Test
    void givenAStoredEntryWithAnArrayPayload_whenTheLogIsRead_thenTheCorruptPayloadFailsClosed() {
        // given
        UUID subjectId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO domain_event (id, event_type, subject_id, occurred_at, payload)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, UUID.randomUUID(), "audit.invalid.recorded", subjectId, Timestamp.from(clock.instant()), "[]");

        // when / then
        assertThatThrownBy(() -> mockMvc.perform(get("/api/admin/audit")
                        .param("subjectId", subjectId.toString()).with(user(administrator))))
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasRootCauseMessage("Stored audit payload must be a JSON object");
    }

    @Test
    void givenACursorNamingNoEntry_whenTheLogIsRead_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/audit").param("cursor", UUID.randomUUID().toString())
                        .with(user(administrator)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:audit-cursor-unknown"));
    }

    @Test
    void givenToEqualsTheEventsTimestamp_whenTheLogIsRead_thenToExcludesIt() throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(9, "Court 9");
        Instant occurredAt = clock.instant();

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .param("to", occurredAt.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(0)));
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .param("to", occurredAt.plusSeconds(1).toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)));
    }

    @Test
    void givenFromEqualsTheEventsTimestamp_whenTheLogIsRead_thenFromIncludesIt() throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(10, "Court 10");
        Instant occurredAt = clock.instant();

        // when / then
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .param("from", occurredAt.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(1)));
        mockMvc.perform(get("/api/admin/audit").param("subjectId", courtId.toString())
                        .param("from", occurredAt.plusSeconds(1).toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(0)));
    }

    @Test
    void givenSeveralEventsSharingATimestamp_whenPagedWithASmallLimit_thenEveryEventAppearsExactlyOnce()
            throws Exception {
        // given
        for (int number = 1; number <= 5; number++) {
            facilityFixture.createCourt(number, "Court " + number);
        }
        String wholePage = mockMvc.perform(get("/api/admin/audit").param("limit", "5")
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> occurredAtValues = JsonPath.read(wholePage, "$.entries[*].occurredAt");
        assertThat(occurredAtValues).as("the fixed test clock must not have advanced")
                .containsOnly(occurredAtValues.get(0));

        // when
        List<String> collected = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        do {
            MockHttpServletRequestBuilder request = get("/api/admin/audit")
                    .param("limit", "2").with(user(administrator));
            if (cursor != null) {
                request = request.param("cursor", cursor);
            }
            String body = mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            collected.addAll(JsonPath.read(body, "$.entries[*].id"));
            cursor = JsonPath.read(body, "$.nextCursor");
            pages++;
        } while (cursor != null && pages < MAX_PAGES);

        // then
        assertThat(pages).as("five entries at limit 2 need at most three pages").isLessThan(MAX_PAGES);
        assertThat(collected).hasSize(5);
        assertThat(new HashSet<>(collected)).hasSize(5);
    }
}
