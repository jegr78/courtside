package org.courtside.dataexchange.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class, FacilityTestFixture.class, BookingTestFixture.class,
        NotificationTestFixture.class})
class RetentionAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final TimeSlot TOMORROW_SIX_PM =
            new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z"));
    private static final TimeSlot TOMORROW_EIGHT_PM =
            new TimeSlot(Instant.parse("2026-05-13T18:00:00Z"), Instant.parse("2026-05-13T19:00:00Z"));

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID admin;
    private UUID adminPerson;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()))
                .apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        adminPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        admin = identity.createAccount(adminPerson, "admin", Set.of(Role.ADMIN));
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoCategoryWithAPeriod_whenABoardPreviews_thenTheRefusalSaysThereIsNothingToPreview() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:retention-not-configured"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriod_whenSetListedAndRemoved_thenTheListFollowsAndNoRecordChanges() throws Exception {
        // when
        mockMvc.perform(put("/api/admin/retention/policies/BOOKINGS").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"retainMonths\": 12}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retainMonths").value(12));

        // then
        mockMvc.perform(get("/api/admin/retention/policies"))
                .andExpect(jsonPath("$[0].category").value("BOOKINGS"))
                .andExpect(jsonPath("$[0].retainMonths").value(12))
                .andExpect(jsonPath("$[1].category").value("FORMER_MEMBERS"))
                .andExpect(jsonPath("$[1]", org.hamcrest.Matchers.hasEntry("retainMonths", null)));

        // when
        mockMvc.perform(delete("/api/admin/retention/policies/BOOKINGS").with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/retention/policies"))
                .andExpect(jsonPath("$[0].retainMonths").doesNotExist());
        assertThat(eventTypes()).as("setting and removing a period are both recorded")
                .containsExactlyInAnyOrder("dataexchange.retention.policySet", "dataexchange.retention.policyRemoved");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPreviewUnderAPeriod_whenThePeriodIsRemoved_thenThePreviewCanNoLongerRun() throws Exception {
        // given
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(jsonPath("$.formerMembers.people").value(1))
                .andReturn().getResponse().getContentAsString();

        // when
        mockMvc.perform(delete("/api/admin/retention/policies/FORMER_MEMBERS").with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:retention-preview-not-found"));
        assertThat(identity.personExists(gone)).as("a period the board took back removes nobody").isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPeriodOfNoMonths_whenSet_thenTheRefusalNamesTheField() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/retention/policies/BOOKINGS").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"retainMonths\": 0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("retainMonths"));
        assertThat(jdbc.sql("SELECT count(*) FROM retention_policy").query(Long.class).single())
                .as("a refused period is not stored").isZero();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnOldAndARecentBooking_whenTheReviewedRunApplies_thenOnlyTheOldOneStopsNamingAnybody()
            throws Exception {
        // given
        UUID janePerson = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(janePerson, "jane.doe", Set.of(Role.MEMBER));
        UUID jane = identity.accountIdOf(janePerson);
        UUID johnPerson = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID old = bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD, TOMORROW_SIX_PM, jane, janePerson,
                Set.of(Role.MEMBER), "Doubles with the neighbours", "Mary Major");
        UUID oldWithMember = bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD, TOMORROW_EIGHT_PM,
                jane, janePerson, Set.of(Role.MEMBER), null, johnPerson);
        UUID recent = bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-14T16:00:00Z"), Instant.parse("2026-05-14T17:00:00Z")),
                jane, janePerson, Set.of(Role.MEMBER), "Keep me", "Richard Miles");
        shiftBack(old, 500);
        shiftBack(oldWithMember, 500);
        shiftBack(recent, 30);
        keep("BOOKINGS", 12);

        // when
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.bookings.bookings").value(2))
                .andExpect(jsonPath("$.bookings.endedBefore").value("2025-05-11T22:00:00Z"))
                .andExpect(jsonPath("$", org.hamcrest.Matchers.hasEntry("formerMembers", null)))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingsPseudonymised").value(2))
                .andExpect(jsonPath("$.formerMembersRemoved").value(0));

        // then
        assertThat(bookingNames(old)).as("the old booking keeps no booker and no note").containsExactly(null, null);
        assertThat(guestNames(old)).as("the guest place stays, its name does not").containsExactly("");
        assertThat(memberParticipants(oldWithMember)).as("a member who played is no longer named").isZero();
        assertThat(allocations(old)).as("the court time stays for utilisation").isEqualTo(1);
        assertThat(bookingNames(recent)).as("a recent booking is untouched")
                .containsExactly(jane.toString(), "Keep me");
        assertThat(guestNames(recent)).containsExactly("Richard Miles");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenRecordsThatTieAnOldBookingToPeople_whenTheRunApplies_thenNoTableKeepsItBesideAPersonOrAccount()
            throws Exception {
        // given
        UUID janePerson = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(janePerson, "jane.doe", Set.of(Role.MEMBER));
        UUID jane = identity.accountIdOf(janePerson);
        UUID john = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID old = bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD, TOMORROW_SIX_PM, jane, janePerson,
                Set.of(Role.MEMBER), null, "Mary Major");
        UUID recent = bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD, TOMORROW_EIGHT_PM, jane,
                janePerson, Set.of(Role.MEMBER), null, "Richard Miles");
        shiftBack(old, 500);
        for (UUID booking : java.util.List.of(old, recent)) {
            logEvent("booking.participant.recorded", booking, jane,
                    "{\"bookingId\": \"" + booking + "\", \"personId\": \"" + john + "\"}");
            notifications.notify(jane, MessageKind.BOOKING_CONFIRMED, booking, clock.instant());
        }
        logEvent("booking.booking.cancelled", old, jane,
                "{\"bookingId\": \"" + old + "\", \"cancelledByAccountId\": \"" + jane + "\"}");
        logEvent("booking.series.created", UUID.randomUUID(), jane,
                "{\"seriesId\": \"" + UUID.randomUUID() + "\", \"bookingIds\": [\"" + old + "\"]}");
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at, parameters)
                        VALUES (:id, :account, 'BOOKING_CONFIRMED', 'QUEUED', 'retention-old', :at, :at,
                                jsonb_build_object('bookingId', CAST(:booking AS text)))
                        """)
                .param("id", UUID.randomUUID()).param("account", jane).param("booking", old.toString())
                .param("at", java.sql.Timestamp.from(clock.instant())).update();
        jdbc.sql("""
                        INSERT INTO event_publication (id, listener_id, event_type, serialized_event, publication_date)
                        VALUES (:id, 'retention-test-listener', 'BookingConfirmed', :event, :at)
                        """)
                .param("id", UUID.randomUUID())
                .param("event", "{\"bookingId\":\"" + old + "\",\"accountId\":\"" + jane + "\"}")
                .param("at", java.sql.Timestamp.from(clock.instant())).update();
        long oldEntries = entriesAbout(old);
        keep("BOOKINGS", 12);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andReturn().getResponse().getContentAsString();

        // when
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingsPseudonymised").value(1));

        // then
        assertThat(recordsNamingSomebodyBeside(old)).as("no table ties the pseudonymised booking to a person")
                .isEmpty();
        assertThat(entriesAbout(old)).as("the change log still shows that each thing happened")
                .isEqualTo(oldEntries);
        assertThat(recordsNamingSomebodyBeside(recent)).as("a booking the run keeps keeps its records")
                .contains("domain_event:booking.participant.recorded", "notification");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenFormerMembers_whenPreviewed_thenTheRemovableAreCountedAndTheOthersBlockedWithTheirReason()
            throws Exception {
        // given
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        UUID board = formerMember("Mary", "Major", "mary.major", Role.ADMIN);
        UUID named = formerMember("John", "Roe", "john.roe");
        UUID recentlyActive = formerMember("Richard", "Roe", "richard.roe");
        identity.recordSignIn(identity.accountIdOf(recentlyActive), Instant.parse("2026-04-01T10:00:00Z"));
        UUID current = roster.addPerson("Ann", "Active", "ann.active@example.org");
        roster.assignMembership(current, ACTIVE_TYPE, LocalDate.of(2020, 1, 1));
        bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD, TOMORROW_SIX_PM, admin, adminPerson,
                Set.of(Role.ADMIN), null, named);
        keep("FORMER_MEMBERS", 24);

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.formerMembers.people").value(1))
                .andExpect(jsonPath("$.formerMembers.accounts").value(1))
                .andExpect(jsonPath("$.formerMembers.membershipEndedBefore").value("2024-05-12"))
                .andExpect(jsonPath("$.blocked.length()").value(2))
                .andExpect(jsonPath("$.blocked[?(@.personId == '" + board + "')].reason").value("ADMINISTRATOR"))
                .andExpect(jsonPath("$.blocked[?(@.personId == '" + named + "')].reason")
                        .value("NAMED_IN_BOOKINGS"));
        assertThat(identity.personExists(gone)).as("a preview removes nobody").isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARemovableFormerMember_whenTheRunApplies_thenThePersonAndTheirAccountLeaveAndTheLogKeepsCountsOnly()
            throws Exception {
        // given
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        UUID account = identity.accountIdOf(gone);
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andReturn().getResponse().getContentAsString();

        // when
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.formerMembersRemoved").value(1))
                .andExpect(jsonPath("$.accountsRemoved").value(1))
                .andExpect(jsonPath("$.formerMembersSkipped").value(0));

        // then
        assertThat(identity.personExists(gone)).as("the former member is removed").isFalse();
        assertThat(identity.accountExists(account)).as("with their account").isFalse();
        String payload = jdbc.sql("SELECT payload::text FROM domain_event WHERE event_type = 'dataexchange.retention.run'")
                .query(String.class).single();
        assertThat(payload).as("the change log counts what the run did and names nobody it removed")
                .contains("\"formerMembersRemoved\": 1").doesNotContain(gone.toString())
                .doesNotContain(account.toString()).doesNotContain("Doe");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFormerMemberWhoSignedInAfterThePreview_whenTheRunApplies_thenTheyAreSkippedAndKept() throws Exception {
        // given
        UUID back = formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andExpect(jsonPath("$.formerMembers.people").value(1))
                .andReturn().getResponse().getContentAsString();
        identity.recordSignIn(identity.accountIdOf(back), clock.instant());

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.formerMembersRemoved").value(0))
                .andExpect(jsonPath("$.formerMembersSkipped").value(1));
        assertThat(identity.personExists(back)).as("a member who came back is not removed").isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenNoRecentProof_whenARunIsAsked_thenItIsRefusedAndThePreviewStillWaits() throws Exception {
        // given
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andReturn().getResponse().getContentAsString();
        MockMvc unproven = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        // when / then
        unproven.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(identity.personExists(gone)).as("a refused run removes nobody").isTrue();
        assertThat(jdbc.sql("SELECT count(*) FROM retention_preview").query(Long.class).single())
                .as("the refused run leaves the preview to be run with proof").isOne();
    }

    @Test
    @WithMockUser(username = "other-admin", roles = "ADMIN")
    void givenAPreviewOfAnotherAccount_whenRun_thenItIsRefusedAndNobodyIsRemoved() throws Exception {
        // given
        UUID otherBoard = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createAccount(otherBoard, "other-admin", Set.of(Role.ADMIN));
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        UUID previewId = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO retention_preview (id, created_by, created_at, expires_at, memberships_ended_before,
                                                       former_member_ids)
                        VALUES (:id, :admin, :now, :later, DATE '2024-05-12', ARRAY[CAST(:gone AS uuid)])
                        """)
                .param("id", previewId).param("admin", admin).param("gone", gone)
                .param("now", java.sql.Timestamp.from(clock.instant()))
                .param("later", java.sql.Timestamp.from(clock.instant().plusSeconds(600)))
                .update();

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:retention-preview-actor-mismatch"));
        assertThat(identity.personExists(gone)).isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnExpiredPreview_whenRun_thenItIsRefusedAsExpiredAndNobodyIsRemoved() throws Exception {
        // given
        UUID gone = formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andReturn().getResponse().getContentAsString();
        jdbc.sql("UPDATE retention_preview SET created_at = created_at - interval '2 hours', "
                + "expires_at = created_at - interval '1 hour'").update();

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:retention-preview-expired"));
        assertThat(identity.personExists(gone)).isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenARunPreview_whenRunAgain_thenTheSecondRequestFindsNoPreview() throws Exception {
        // given
        formerMember("Jane", "Doe", "jane.doe");
        keep("FORMER_MEMBERS", 24);
        String preview = mockMvc.perform(post("/api/admin/retention/previews").with(csrf()))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isOk());

        // when / then
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", previewId(preview)).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:retention-preview-not-found"));
        assertThat(eventTypes().stream().filter("dataexchange.retention.run"::equals).count())
                .as("a preview runs once").isOne();
    }

    @Test
    @WithMockUser(username = "jane.doe", roles = "MEMBER")
    void givenAMember_whenTheyAskForAnyRetentionOperation_thenEveryOneIsForbidden() throws Exception {
        // given
        UUID jane = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(jane, "jane.doe", Set.of(Role.MEMBER));

        // when / then
        mockMvc.perform(get("/api/admin/retention/policies")).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/retention/previews").with(csrf())).andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/retention/previews/{id}/run", UUID.randomUUID()).with(csrf()))
                .andExpect(status().isForbidden());
    }

    private UUID formerMember(String firstName, String lastName, String username) {
        return formerMember(firstName, lastName, username, Role.MEMBER);
    }

    private UUID formerMember(String firstName, String lastName, String username, Role role) {
        UUID personId = roster.addPerson(firstName, lastName, username + "@example.org");
        roster.giveAccount(personId, username, Set.of(role));
        roster.assignMembership(personId, ACTIVE_TYPE, LocalDate.of(2018, 1, 1));
        jdbc.sql("UPDATE member SET ended_on = DATE '2023-06-30' WHERE person_id = :id").param("id", personId).update();
        jdbc.sql("UPDATE user_account SET created_at = TIMESTAMPTZ '2018-01-01 10:00Z', "
                        + "last_login_at = TIMESTAMPTZ '2023-06-01 10:00Z' WHERE person_id = :id")
                .param("id", personId).update();
        return personId;
    }

    private void logEvent(String type, UUID subject, UUID actor, String payload) {
        jdbc.sql("""
                        INSERT INTO domain_event (id, event_type, subject_id, actor_account_id, occurred_at, payload)
                        VALUES (:id, :type, :subject, :actor, :at, CAST(:payload AS jsonb))
                        """)
                .param("id", UUID.randomUUID()).param("type", type).param("subject", subject).param("actor", actor)
                .param("at", java.sql.Timestamp.from(clock.instant())).param("payload", payload).update();
    }

    private long entriesAbout(UUID bookingId) {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE subject_id = :id OR strpos(payload::text, :text) > 0")
                .param("id", bookingId).param("text", bookingId.toString()).query(Long.class).single();
    }

    private java.util.List<String> recordsNamingSomebodyBeside(UUID bookingId) {
        java.util.List<String> found = new java.util.ArrayList<>(jdbc.sql("""
                        SELECT 'domain_event:' || event_type FROM domain_event e
                        WHERE (e.subject_id = :id OR strpos(e.payload::text, :text) > 0)
                          AND (e.actor_account_id IS NOT NULL
                               OR EXISTS (SELECT 1 FROM jsonb_object_keys(e.payload) key WHERE key ~* :personal))
                        """)
                .param("id", bookingId).param("text", bookingId.toString())
                .param("personal", org.courtside.dataexchange.internal.RetentionRows.PERSONAL_PAYLOAD_FIELD)
                .query(String.class).list());
        for (String table : java.util.List.of("notification", "message_record")) {
            found.addAll(jdbc.sql("SELECT '" + table + "' FROM " + table + " WHERE strpos(parameters::text, :text) > 0")
                    .param("text", bookingId.toString()).query(String.class).list());
        }
        found.addAll(jdbc.sql("SELECT 'event_publication' FROM event_publication WHERE strpos(serialized_event, :text) > 0")
                .param("text", bookingId.toString()).query(String.class).list());
        return found;
    }

    private void keep(String category, int months) throws Exception {
        mockMvc.perform(put("/api/admin/retention/policies/{category}", category).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"retainMonths\": " + months + "}"))
                .andExpect(status().isOk());
    }

    private void shiftBack(UUID bookingId, int days) {
        jdbc.sql("UPDATE court_allocation SET starts_at = starts_at - make_interval(days => :days), "
                        + "ends_at = ends_at - make_interval(days => :days) WHERE booking_id = :id")
                .param("days", days).param("id", bookingId).update();
        jdbc.sql("UPDATE booking SET created_at = created_at - make_interval(days => :days) WHERE id = :id")
                .param("days", days).param("id", bookingId).update();
    }

    private java.util.List<String> bookingNames(UUID bookingId) {
        return jdbc.sql("SELECT booked_by::text AS booker, note FROM booking WHERE id = :id").param("id", bookingId)
                .query((rs, row) -> java.util.Arrays.asList(rs.getString("booker"), rs.getString("note"))).single();
    }

    private java.util.List<String> guestNames(UUID bookingId) {
        return jdbc.sql("SELECT guest_name FROM booking_participant WHERE booking_id = :id AND kind = 'GUEST'")
                .param("id", bookingId).query(String.class).list();
    }

    private long memberParticipants(UUID bookingId) {
        return jdbc.sql("SELECT count(*) FROM booking_participant WHERE booking_id = :id AND kind = 'MEMBER'")
                .param("id", bookingId).query(Long.class).single();
    }

    private long allocations(UUID bookingId) {
        return jdbc.sql("SELECT count(*) FROM court_allocation WHERE booking_id = :id")
                .param("id", bookingId).query(Long.class).single();
    }

    private java.util.List<String> eventTypes() {
        return jdbc.sql("SELECT event_type FROM domain_event WHERE event_type LIKE 'dataexchange.retention.%' "
                + "ORDER BY occurred_at, id").query(String.class).list();
    }

    private static String previewId(String preview) {
        return JsonPath.read(preview, "$.previewId");
    }
}
