package org.courtside.dataexchange.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ExternalReferenceService;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class, FacilityTestFixture.class,
        BookingTestFixture.class, AuditTestFixture.class})
class SubjectAccessAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ACTIVE_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-13T18:00:00Z");
    private static final String NOTE = "Doubles against the neighbours";
    private static final String GUEST = "Richard Miles";

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
    private AuditTestFixture audit;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    private MockMvc mockMvc;
    private UUID courtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @AfterEach
    void signOut() {
        identity.signOut();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonTheInstanceHoldsEverythingAbout_whenABoardAsks_thenEachOfThoseThingsIsAnswered()
            throws Exception {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(personId, "jane.doe", Set.of(Role.MEMBER));
        UUID membershipTypeId = roster.createMembershipType("Adult");
        roster.assignMembership(personId, membershipTypeId, LocalDate.of(2026, 1, 1));
        UUID accountId = identity.accountIdOf(personId);
        UUID bookingId = bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), accountId, personId, Set.of(Role.MEMBER), NOTE, GUEST);
        references.link(importSource(), "4711", personId);

        // when / then
        mockMvc.perform(export(personId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(personId.toString()))
                .andExpect(jsonPath("$.firstName").value("Jane"))
                .andExpect(jsonPath("$.email").value("jane.doe@example.org"))
                .andExpect(jsonPath("$.account.accountId").value(accountId.toString()))
                .andExpect(jsonPath("$.account.username").value("jane.doe"))
                .andExpect(jsonPath("$.account.roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.account.credentialState").value("CREDENTIAL_ISSUED"))
                .andExpect(jsonPath("$.memberships[0].membershipTypeId")
                        .value(membershipTypeId.toString()))
                .andExpect(jsonPath("$.memberships[0].membershipType").value("Adult"))
                .andExpect(jsonPath("$.memberships[0].startedOn").value("2026-01-01"))
                .andExpect(jsonPath("$.bookingsMade[0].bookingId").value(bookingId.toString()))
                .andExpect(jsonPath("$.bookingsMade[0].note").value(NOTE))
                .andExpect(jsonPath("$.bookingsMade[0].reservations[0].courtId")
                        .value(courtId.toString()))
                .andExpect(jsonPath("$.externalReferences[0].externalId").value("4711"))
                .andExpect(jsonPath("$.changesAsSubject[?(@.eventType == 'roster.person.added')]")
                        .value(hasSize(1)))
                .andExpect(jsonPath(
                        "$.changesAsSubject[?(@.eventType == 'identity.account.credentialsRequested')]")
                        .value(hasSize(1)));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWhoHoldsNoAccount_whenABoardAsks_thenTheAnswerIsCompleteWithoutOne()
            throws Exception {
        // given
        UUID personId = roster.addPerson("John", "Roe", "john.roe@example.org");

        // when / then
        mockMvc.perform(export(personId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.account").doesNotExist())
                .andExpect(jsonPath("$.bookingsMade").value(hasSize(0)))
                .andExpect(jsonPath("$.changesAsActor").value(hasSize(0)))
                .andExpect(jsonPath("$.changesAsSubject").value(hasSize(1)));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABookingNamingSomebodyElse_whenABoardAsksAboutTheMaker_thenNeitherCoPlayerNorGuestIsNamed()
            throws Exception {
        // given
        UUID makerId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(makerId, "jane.doe", Set.of(Role.MEMBER));
        UUID makerAccountId = identity.accountIdOf(makerId);
        UUID namedId = roster.addPerson("John", "Roe", "john.roe@example.org");
        bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), makerAccountId, makerId, Set.of(Role.MEMBER), NOTE,
                namedId);
        bookings.createBookingWithGuest(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SEVEN_PM, EIGHT_PM), makerAccountId, makerId, Set.of(Role.MEMBER), NOTE,
                GUEST);

        // when
        String answer = mockMvc.perform(export(makerId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingsMade").value(hasSize(2)))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(answer)
                .as("the people a member played with are answered about that member, not this one")
                .doesNotContain(namedId.toString(), GUEST, "John", "Roe");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABookingSomebodyElseMade_whenABoardAsksAboutTheNamedMember_thenNeitherMakerNorNoteIsNamed()
            throws Exception {
        // given
        UUID makerId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.giveAccount(makerId, "jane.doe", Set.of(Role.MEMBER));
        UUID makerAccountId = identity.accountIdOf(makerId);
        UUID namedId = roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID bookingId = bookings.createBookingNamingMember(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), makerAccountId, makerId, Set.of(Role.MEMBER), NOTE,
                namedId);

        // when
        String answer = mockMvc.perform(export(namedId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingsRecordedIn[0].bookingId").value(bookingId.toString()))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(answer)
                .as("somebody else made this booking, so their words and their identity stay theirs")
                .doesNotContain(NOTE, makerId.toString(), makerAccountId.toString(), "Jane", "Doe");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPersonWhoCorrectedSomebodyElsesRecord_whenABoardAsks_thenTheChangeIsNamedAndNotItsSubject()
            throws Exception {
        // given
        UUID boardPersonId = roster.addPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(boardPersonId, "mary.major", Set.of(Role.ADMIN));
        UUID otherPersonId = roster.addPerson("John", "Roe", "john.roe@example.org");
        identity.signInAs("mary.major");
        roster.changePerson(otherPersonId, "John", "Miles", "john.miles@example.org");

        // when
        String answer = mockMvc.perform(export(boardPersonId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changesAsActor[?(@.eventType == 'roster.person.corrected')]")
                        .value(hasSize(1)))
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(answer)
                .as("the subject of a change this person made is somebody else's record")
                .doesNotContain(otherPersonId.toString(), "fields", "John", "Roe", "Miles");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenTheAnswerIsProduced_thenTheChangeLogRecordsThatItWas() throws Exception {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // when
        mockMvc.perform(export(personId)).andExpect(status().isOk());

        // then
        assertThat(audit.eventsAbout(personId, "dataexchange.subjectAccess.answered"))
                .singleElement()
                .satisfies(event -> assertThat(event.payload())
                        .as("the record says an answer was produced, never what was in it")
                        .containsOnlyKeys("personId")
                        .containsEntry("personId", personId.toString()));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenAPersonNobodyHoldsIsAskedAbout_thenItIsRefusedAsUnknown() throws Exception {
        // when / then
        mockMvc.perform(export(UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:subject-access-person-not-found"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberRatherThanTheBoard_whenTheyAskWhatIsHeldAboutSomebody_thenItIsRefused()
            throws Exception {
        // given
        UUID personId = roster.addPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        mockMvc.perform(export(personId)).andExpect(status().isForbidden());
    }

    @Test
    void givenNobodyIsSignedIn_whenTheyAskWhatIsHeldAboutSomebody_thenItIsRefused() throws Exception {
        // when / then
        mockMvc.perform(export(UUID.randomUUID())).andExpect(status().isUnauthorized());
    }

    private static org.springframework.test.web.servlet.RequestBuilder export(UUID personId) {
        return post("/api/admin/export/person/" + personId).with(csrf());
    }

    private UUID importSource() {
        return sources.create("roster-system", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(), 10).sourceId();
    }
}
