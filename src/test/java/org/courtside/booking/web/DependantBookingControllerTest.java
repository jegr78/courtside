package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.GuardianGrant;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, RulesTestFixture.class,
        AuditTestFixture.class})
class DependantBookingControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DEFAULT_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID DEFAULT_MEMBERSHIP_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final String NOT_GRANTED = "urn:courtside:error:guardian-action-not-granted";
    private static final String NOT_A_DEPENDANT = "urn:courtside:error:dependant-not-found";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsService userDetails;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facility.createCourt(1, "Court 1");
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenAGuardianGrantedToBook_whenBookingForTheDependant_thenTheDependantHoldsItAndTheGuardianActed()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK));

        // when
        UUID id = idOf(book(as("doe.jane"), john, "guardian-key", "18:00", "19:00")
                .andExpect(status().isCreated()));

        // then
        Booking booking = bookings.findWithAllocationsById(id).orElseThrow();
        assertThat(booking.getBookedBy()).as("the dependant's account holds the booking").isEqualTo(johnAccount);
        assertThat(booking.getActedBy()).as("the guardian is recorded as the one who acted").isEqualTo(janeAccount);
        assertThat(jdbc.sql("SELECT person_id FROM booking_participant WHERE booking_id = :id ORDER BY position LIMIT 1")
                .param("id", id).query(UUID.class).single())
                .as("the dependant takes the first place").isEqualTo(john);
        assertThat(audit.eventsAbout(id, "booking.booking.confirmed"))
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .as("the change log names the guardian").containsExactly(janeAccount);
    }

    @Test
    void givenAnAdministratorGuardian_whenBookingForADependantBarredFromCourts_thenTheDependantsRulesRefuseIt()
            throws Exception {
        // given
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.ADMIN));
        UUID barred = members.membershipTypeMeasuredBy("Barred", rules.ruleSetBarringCourtBookings("No courts"));
        members.assignMembership(john, barred, LocalDate.of(2026, 1, 1));
        members.linkGuardian(richard, john, Set.of(GuardianGrant.BOOK));
        long before = bookings.count();

        // when / then
        book(as("miles.richard"), john, "admin-key", "18:00", "19:00")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-rules-violated"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.rule.noCourtBooking"));
        assertThat(bookings.count()).as("the guardian's administrator role overrides nothing").isEqualTo(before);
    }

    @Test
    void givenADependantWhoIsAnAdministrator_whenTheGuardianBooksForThem_thenTheOverrideStaysTheDependantsOwn()
            throws Exception {
        // given
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.ADMIN));
        UUID barred = members.membershipTypeMeasuredBy("Barred", rules.ruleSetBarringCourtBookings("No courts"));
        members.assignMembership(richard, barred, LocalDate.of(2026, 1, 1));
        members.linkGuardian(jane, richard, Set.of(GuardianGrant.BOOK));

        // when / then
        book(as("doe.jane"), richard, "for-the-board", "18:00", "19:00")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.violations[0].code").value("booking.rule.noCourtBooking"));
    }

    @Test
    void givenARelationshipThatDoesNotGrantBooking_whenTheGuardianBooks_thenTheActionIsRefusedByName()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.VIEW_BOOKINGS));
        long before = bookings.count();

        // when / then
        book(as("doe.jane"), john, "refused-key", "18:00", "19:00")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value(NOT_GRANTED))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.actionNotGranted"))
                .andExpect(jsonPath("$.violations[0].params.action").value("BOOK"));
        assertThat(bookings.count()).isEqualTo(before);
    }

    @Test
    void givenNoRelationshipHoldingToday_whenSomebodyActsForThePerson_thenThePersonIsNoDependantOfTheirs()
            throws Exception {
        // given
        UUID ended = members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK, GuardianGrant.VIEW_BOOKINGS));
        members.endGuardianship(jane, ended);
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.MEMBER));

        // when / then
        book(as("doe.jane"), john, "ended-key", "18:00", "19:00")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value(NOT_A_DEPENDANT));
        mockMvc.perform(get("/api/my/dependants/{personId}/bookings", john).with(as("major.mary")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value(NOT_A_DEPENDANT));
    }

    @Test
    void givenADisabledDependantAccount_whenTheGuardianBooks_thenItIsRefusedWhileTheBookingsStayReadable()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK, GuardianGrant.VIEW_BOOKINGS));
        identity.disableAccount(johnAccount);

        // when / then
        book(as("doe.jane"), john, "disabled-key", "18:00", "19:00")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:dependant-account-disabled"));
        mockMvc.perform(get("/api/my/dependants/{personId}/bookings", john).with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    void givenTheDependantUsedAKey_whenTheGuardianBooksWithTheSameKey_thenTheKeysNeverMeet() throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK));
        UUID own = idOf(book(as("roe.john"), null, "shared-key", "18:00", "19:00")
                .andExpect(status().isCreated()));

        // when
        UUID forDependant = idOf(book(as("doe.jane"), john, "shared-key", "19:00", "20:00")
                .andExpect(status().isCreated()));
        UUID repeated = idOf(book(as("doe.jane"), john, "shared-key", "19:00", "20:00")
                .andExpect(status().isCreated()));

        // then
        assertThat(forDependant).as("the guardian's key is not the dependant's").isNotEqualTo(own);
        assertThat(repeated).as("the guardian repeating their request gets their booking back")
                .isEqualTo(forDependant);
    }

    @Test
    void givenTwoGuardiansOfOneDependant_whenBothBookWithTheSameKey_thenEachGetsTheirOwnBooking() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.MEMBER));
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK));
        members.linkGuardian(mary, john, Set.of(GuardianGrant.BOOK));
        UUID janes = idOf(book(as("doe.jane"), john, "family-key", "18:00", "19:00")
                .andExpect(status().isCreated()));

        // when
        UUID marys = idOf(book(as("major.mary"), john, "family-key", "19:00", "20:00")
                .andExpect(status().isCreated()));

        // then
        assertThat(marys).as("one guardian's key never answers for another's").isNotEqualTo(janes);
        assertThat(bookings.findById(marys).orElseThrow().getActedBy()).isNotEqualTo(janeAccount);
    }

    @Test
    void givenARelationshipThatDoesNotGrantViewing_whenTheGuardianListsTheDependantsBookings_thenItIsRefusedByName()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK, GuardianGrant.CANCEL_BOOKINGS));

        // when / then
        mockMvc.perform(get("/api/my/dependants/{personId}/bookings", john).with(as("doe.jane")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value(NOT_GRANTED))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.actionNotGranted"))
                .andExpect(jsonPath("$.violations[0].params.action").value("VIEW_BOOKINGS"));
    }

    @Test
    void givenAGuardianGrantedToView_whenListingTheDependantsBookings_thenTheyAreTheDependantsOnly() throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK, GuardianGrant.VIEW_BOOKINGS));
        UUID forJohn = idOf(book(as("doe.jane"), john, "for-john", "18:00", "19:00").andExpect(status().isCreated()));
        idOf(book(as("doe.jane"), null, "janes-own", "19:00", "20:00").andExpect(status().isCreated()));

        // when / then
        mockMvc.perform(get("/api/my/dependants/{personId}/bookings", john).with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(forJohn.toString()));
    }

    @Test
    void givenAGuardianGrantedToCancel_whenCancellingTheDependantsBooking_thenItIsCancelledInTheDependantsName()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.CANCEL_BOOKINGS));
        UUID id = idOf(book(as("roe.john"), null, "johns-own", "18:00", "19:00").andExpect(status().isCreated()));

        // when
        mockMvc.perform(delete("/api/my/dependants/{personId}/bookings/{bookingId}", john, id)
                        .with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        Booking booking = bookings.findById(id).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(booking.getCancelledBy()).as("cancelled in the holder's name").isEqualTo(johnAccount);
        assertThat(audit.eventsAbout(id, "booking.booking.cancelled"))
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .as("the change log names the guardian").containsExactly(janeAccount);
    }

    @Test
    void givenARelationshipThatDoesNotGrantCancelling_whenTheGuardianCancels_thenItIsRefusedByNameAndStands()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK, GuardianGrant.VIEW_BOOKINGS));
        UUID id = idOf(book(as("roe.john"), null, "johns-own", "18:00", "19:00").andExpect(status().isCreated()));

        // when / then
        mockMvc.perform(delete("/api/my/dependants/{personId}/bookings/{bookingId}", john, id)
                        .with(as("doe.jane")).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value(NOT_GRANTED))
                .andExpect(jsonPath("$.violations[0].code").value("guardianship.actionNotGranted"))
                .andExpect(jsonPath("$.violations[0].params.action").value("CANCEL_BOOKINGS"));
        assertThat(bookings.findById(id).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenABookingTheDependantDoesNotHold_whenTheGuardianCancelsIt_thenItIsNoBookingOfTheirs() throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.CANCEL_BOOKINGS));
        UUID janes = idOf(book(as("doe.jane"), null, "janes-own", "18:00", "19:00").andExpect(status().isCreated()));

        // when / then
        mockMvc.perform(delete("/api/my/dependants/{personId}/bookings/{bookingId}", john, janes)
                        .with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
        assertThat(bookings.findById(janes).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenADependantWhoManagesTrainings_whenTheGuardianCancelsSomebodyElsesTraining_thenTheRoleLendsNothing()
            throws Exception {
        // given
        UUID trainer = identity.createPerson("Richard", "Roe", "richard.roe@example.org");
        identity.createEnabledAccount(trainer, "roe.richard", Set.of(Role.TRAINER));
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.TRAINER));
        members.linkGuardian(jane, trainer, Set.of(GuardianGrant.CANCEL_BOOKINGS));
        UUID marys = idOf(mockMvc.perform(post("/api/bookings")
                        .header("Idempotency-Key", "marys-training")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "%s",
                                  "startsAt": "2026-05-12T18:00:00+02:00",
                                  "endsAt": "2026-05-12T19:00:00+02:00"
                                }
                                """.formatted(courtId, TRAINING_CARD))
                        .with(as("major.mary"))
                        .with(csrf()))
                .andExpect(status().isCreated()));

        // when / then
        mockMvc.perform(delete("/api/my/dependants/{personId}/bookings/{bookingId}", trainer, marys)
                        .with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
        assertThat(bookings.findById(marys).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenADisabledGuardianAccount_whenItsSessionActsForTheDependant_thenItIsSignedOutBeforeAnythingIsRead()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.VIEW_BOOKINGS));
        RequestPostProcessor stillSignedIn = as("doe.jane");
        identity.disableAccount(janeAccount);

        // when / then
        mockMvc.perform(get("/api/my/dependants/{personId}/bookings", john).with(stillSignedIn))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenTheDependantsDeadlineHasPassed_whenAnAdministratorGuardianCancels_thenTheDeadlineStillHolds()
            throws Exception {
        // given
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.ADMIN));
        members.linkGuardian(richard, john, Set.of(GuardianGrant.CANCEL_BOOKINGS));
        UUID id = idOf(book(as("roe.john"), null, "johns-own", "18:00", "19:00").andExpect(status().isCreated()));
        members.assignMembership(john, DEFAULT_MEMBERSHIP_TYPE);
        rules.setCancellationDeadline(DEFAULT_RULE_SET, 361);

        // when / then
        mockMvc.perform(delete("/api/my/dependants/{personId}/bookings/{bookingId}", john, id)
                        .with(as("miles.richard")).with(csrf()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.violations[0].code").value("booking.rule.cancellationDeadline.exceeded"));
        assertThat(bookings.findById(id).orElseThrow().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
    }

    private RequestPostProcessor as(String username) {
        return SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername(username));
    }

    private ResultActions book(RequestPostProcessor caller, UUID dependant, String key, String start, String end)
            throws Exception {
        String body = """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "2026-05-12T%s:00+02:00",
                  "endsAt": "2026-05-12T%s:00+02:00",
                  "participants": [ { "guestName": "Partner" } ]
                }
                """.formatted(courtId, MEMBER_BOOKING_CARD, start, end);
        return mockMvc.perform((dependant == null ? post("/api/bookings")
                        : post("/api/my/dependants/{personId}/bookings", dependant))
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(caller)
                .with(csrf()));
    }

    private static UUID idOf(ResultActions created) throws Exception {
        return UUID.fromString(JsonPath.read(created.andReturn().getResponse().getContentAsString(), "$.id"));
    }
}
