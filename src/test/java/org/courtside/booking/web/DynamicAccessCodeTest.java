package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.access.testfixture.AccessTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.GuardianGrant;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.access-control.connector=simulated")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, BookingTestFixture.class,
        CardTestFixture.class, ConfigTestFixture.class, AccessTestFixture.class, AuditTestFixture.class})
class DynamicAccessCodeTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String EMERGENCY_CODE = "975310";
    private static final String REFUSED = "urn:courtside:error:emergency-code-refused";
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    private static final TimeSlot AFTERNOON =
            new TimeSlot(Instant.parse("2026-05-12T13:00:00Z"), Instant.parse("2026-05-12T14:00:00Z"));

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
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private AccessTestFixture access;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID court;
    private UUID northGate;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void aClubWhoseNorthGateTakesCodesFromTheAccessControlSystem() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        northGate = facility.createAccessPointWithEmergencyCode("North gate", List.of(court), EMERGENCY_CODE);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.MEMBER));
    }

    @Test
    void givenAnInstalledGrant_whenTheBookerAndThePlayerReadTheirBookings_thenBothSeeTheBookingsCode()
            throws Exception {
        // given
        UUID booking = book(EVENING);
        access.installDueGrants();
        String code = access.installedCodeOf(booking);

        // when
        String own = read("/api/my/bookings", "doe.jane");
        String played = read("/api/my/participations", "roe.john");

        // then
        assertThat(codesOf(own, booking)).as("the booker sees the code the door accepted").containsExactly(code);
        assertThat(codesOf(played, booking)).as("so does the player named in it").containsExactly(code);
        assertThat(JsonPath.<String>read(own, "$.items[0].access.codes[0].accessPointName"))
                .isEqualTo("North gate");
        assertThat(JsonPath.<Boolean>read(own, "$.items[0].access.codePending")).as("an installed code is not pending")
                .isNull();
        assertThat(own).doesNotContain(EMERGENCY_CODE);
    }

    @Test
    void givenAnInstalledGrant_whenAnotherMemberReadsTheirOwnPages_thenTheCodeAppearsNowhere() throws Exception {
        // given
        UUID booking = book(EVENING);
        access.installDueGrants();
        String code = access.installedCodeOf(booking);

        // when
        List<String> pages = List.of(read("/api/my/bookings", "major.mary"),
                read("/api/my/participations", "major.mary"));

        // then
        assertThat(pages).as("a member outside the booking is never handed its code")
                .allSatisfy(page -> assertThat(page).doesNotContain(code).doesNotContain(booking.toString()));
    }

    @Test
    void givenAGuardianOfThePlayer_whenTheyReadTheDependantsBookings_thenTheBookingsOwnCodeIsNotThere()
            throws Exception {
        // given
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.MEMBER));
        members.linkGuardian(richard, jane, Set.of(GuardianGrant.VIEW_BOOKINGS));
        UUID booking = book(EVENING);
        access.installDueGrants();
        String code = access.installedCodeOf(booking);

        // when
        String page = read("/api/my/dependants/" + jane + "/bookings", "miles.richard");

        // then
        assertThat(page).as("the guardian sees the booking").contains(booking.toString());
        assertThat(page).as("but a booking's own code goes only to its participants").doesNotContain(code);
    }

    @Test
    void givenAGrantNotYetInstalled_whenTheBookerReadsTheBooking_thenTheCodeIsPendingAndTheEmergencyCodeOffered()
            throws Exception {
        // given
        UUID booking = book(EVENING);

        // when
        String page = read("/api/my/bookings", "doe.jane");

        // then
        assertThat(codesOf(page, booking)).as("no code before a door accepted one").isEmpty();
        assertThat(JsonPath.<Boolean>read(page, "$.items[0].access.codePending")).isTrue();
        assertThat(JsonPath.<Boolean>read(page, "$.items[0].access.emergencyCodeKept")).isTrue();
        assertThat(page).as("the emergency code itself is only answered on request").doesNotContain(EMERGENCY_CODE);
    }

    @Test
    void givenTheBookerAndThePlayerInsideTheWindow_whenTheyAskForTheEmergencyCode_thenItIsAnsweredAndAudited()
            throws Exception {
        // given
        config.openAccessPointsAround(240, 15);
        UUID booking = book(AFTERNOON);

        // when
        ResultActions booker = ask("/api/my/bookings/" + booking + "/emergency-code", "doe.jane");
        ResultActions player = ask("/api/my/participations/" + booking + "/emergency-code", "roe.john");

        // then
        booker.andExpect(status().isOk())
                .andExpect(jsonPath("$.codes[0].accessPointName").value("North gate"))
                .andExpect(jsonPath("$.codes[0].code").value(EMERGENCY_CODE));
        player.andExpect(status().isOk()).andExpect(jsonPath("$.codes[0].code").value(EMERGENCY_CODE));
        List<AuditTestFixture.RecordedEvent> recorded =
                audit.eventsAbout(booking, "booking.emergencyCode.requested");
        assertThat(recorded).as("every answer is recorded with who asked")
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .containsExactlyInAnyOrder(janeAccount, johnAccount);
        assertThat(recorded).as("and which access point, never the code").allSatisfy(event ->
                assertThat(event.payload()).containsEntry("accessPointIds", List.of(northGate.toString())));
        assertThat(jdbc.sql("SELECT payload::text FROM domain_event").query(String.class).list())
                .noneMatch(payload -> payload.contains(EMERGENCY_CODE));
    }

    @Test
    void givenABookingWhoseWindowHasNotOpened_whenTheBookerAsksForTheEmergencyCode_thenItIsRefusedByReason()
            throws Exception {
        // given
        UUID booking = book(EVENING);

        // when / then
        ask("/api/my/bookings/" + booking + "/emergency-code", "doe.jane")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(REFUSED))
                .andExpect(jsonPath("$.violations[0].code").value("booking.emergencyCode.outsideWindow"));
        assertThat(audit.eventsAbout(booking, "booking.emergencyCode.requested")).isEmpty();
    }

    @Test
    void givenAnotherMembersBooking_whenAMemberOutsideItAsksForTheEmergencyCode_thenItIsRefusedWithoutTheCode()
            throws Exception {
        // given
        config.openAccessPointsAround(240, 15);
        UUID booking = book(AFTERNOON);

        // when / then
        for (String path : List.of("/api/my/bookings/", "/api/my/participations/")) {
            String answer = ask(path + booking + "/emergency-code", "major.mary")
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.type").value(REFUSED))
                    .andExpect(jsonPath("$.violations[0].code").value("booking.emergencyCode.notParticipant"))
                    .andReturn().getResponse().getContentAsString();
            assertThat(answer).as("nobody outside the booking learns the code").doesNotContain(EMERGENCY_CODE);
        }
    }

    @Test
    void givenAnUnknownBooking_whenAMemberAsksForItsEmergencyCode_thenItIsNotFound() throws Exception {
        // when / then
        ask("/api/my/bookings/" + UUID.randomUUID() + "/emergency-code", "doe.jane")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
    }

    @Test
    void givenAnAccessPointWithoutAnEmergencyCode_whenTheBookerAsksForOne_thenItIsRefusedAsNoneKept()
            throws Exception {
        // given
        config.openAccessPointsAround(240, 15);
        facility.changeAccessPoint(northGate, "North gate", List.of(court), null);
        UUID booking = book(AFTERNOON);

        // when / then
        ask("/api/my/bookings/" + booking + "/emergency-code", "doe.jane")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(REFUSED))
                .andExpect(jsonPath("$.violations[0].code").value("booking.emergencyCode.noneKept"));
    }

    private UUID book(TimeSlot slot) {
        return bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD, slot, janeAccount, jane,
                Set.of(Role.MEMBER), null, john);
    }

    private String read(String path, String username) throws Exception {
        return mockMvc.perform(get(path).with(as(username)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private ResultActions ask(String path, String username) throws Exception {
        return mockMvc.perform(post(path).with(as(username)).with(csrf()));
    }

    private static List<String> codesOf(String page, UUID booking) {
        return JsonPath.read(page, "$.items[?(@.id == '" + booking + "')].access.codes[*].code");
    }

    private RequestPostProcessor as(String username) {
        return SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername(username));
    }
}
