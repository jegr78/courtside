package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ExternalDoorCodeVisibilityTest extends AbstractIntegrationTest {

    private static final String CLUBHOUSE_CODE = "135790";
    private static final String HALL_CODE = "864200";
    private static final String NORTH_CODE = "246802";
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    private static final Map<String, String> CLUBHOUSE =
            Map.of("accessPointName", "Clubhouse door", "code", CLUBHOUSE_CODE);
    private static final Map<String, String> HALL = Map.of("accessPointName", "Hall door", "code", HALL_CODE);

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

    private MockMvc mockMvc;
    private UUID court;
    private UUID winterDoubles;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void aClubhouseDoorAHallDoorBesideCourtOneAndAnExternalPlayer() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        facility.createAccessPoint("Clubhouse door", List.of(), CLUBHOUSE_CODE, true);
        facility.createAccessPoint("Hall door", List.of(court), HALL_CODE, true);
        facility.createAccessPoint("North gate", List.of(court), NORTH_CODE);
        config.admitExternalBookings(true);
        winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        cards.letBookingsReceiveAccessCodes(winterDoubles, true);
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
    }

    @Test
    void givenAnExternalPlayerWithAnUpcomingBooking_whenReadingTheDoorCodes_thenEveryDoorOpenToMembersComes()
            throws Exception {
        // given
        book(winterDoubles);

        // when
        String codes = read("/api/my/door-codes");

        // then
        assertThat(JsonPath.<List<Map<String, String>>>read(codes, "$"))
                .as("a booking that grants access opens the doors open to members, days before play as well")
                .containsExactly(CLUBHOUSE, HALL);
    }

    @Test
    void givenAnExternalPlayerWithoutABooking_whenReadingTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // when / then
        assertThat(read("/api/my/door-codes")).as("registering alone opens no door").isEqualTo("[]");
    }

    @Test
    void givenAnExternalPlayerWhoseBookingGrantsNoAccess_whenReadingTheDoorCodes_thenTheListIsEmpty()
            throws Exception {
        // given
        cards.letBookingsReceiveAccessCodes(winterDoubles, false);
        book(winterDoubles);

        // when / then
        assertThat(read("/api/my/door-codes")).as("the card decides whether a booking opens doors").isEqualTo("[]");
    }

    @Test
    void givenAnExternalPlayerWhoCancelledTheirBooking_whenReadingTheDoorCodes_thenTheListIsEmpty()
            throws Exception {
        // given
        bookings.cancelBooking(book(winterDoubles), johnAccount, Set.of(Role.EXTERNAL));

        // when / then
        assertThat(read("/api/my/door-codes")).as("a cancelled booking opens nothing").isEqualTo("[]");
    }

    @Test
    void givenAnExternalPlayerWhoseLastWindowHasEnded_whenReadingTheDoorCodes_thenTheListIsEmpty()
            throws Exception {
        // given
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(Instant.parse("2026-05-12T08:00:00Z"), Instant.parse("2026-05-12T09:00:00Z")),
                johnAccount);

        // when / then
        assertThat(read("/api/my/door-codes")).as("its window closed at 09:15, before the clock's 10:00")
                .isEqualTo("[]");
    }

    @Test
    void givenAnExternalPlayerWhoseBookingEndedTenMinutesAgo_whenReadingTheDoorCodes_thenTheyStillCome()
            throws Exception {
        // given
        bookings.insertBookingThatHasStarted(court, winterDoubles,
                new TimeSlot(Instant.parse("2026-05-12T08:50:00Z"), Instant.parse("2026-05-12T09:50:00Z")),
                johnAccount);

        // when
        String codes = read("/api/my/door-codes");

        // then
        assertThat(JsonPath.<List<Map<String, String>>>read(codes, "$"))
                .as("the changing room stays open until the window closes at 10:05")
                .containsExactly(CLUBHOUSE, HALL);
    }

    @Test
    void givenAnExternalPlayerWhoBecameAMember_whenReadingTheDoorCodes_thenTheyComeWithoutABooking()
            throws Exception {
        // given
        members.holdRunningMembership(john);

        // when
        String codes = read("/api/my/door-codes");

        // then
        assertThat(JsonPath.<List<Map<String, String>>>read(codes, "$"))
                .as("a running membership opens the doors like for every member")
                .containsExactly(CLUBHOUSE, HALL);
    }

    @Test
    void givenADisabledExternalPlayerWithAnUpcomingBooking_whenReadingTheDoorCodes_thenTheListIsEmpty()
            throws Exception {
        // given
        book(winterDoubles);
        identity.disableAccount(johnAccount);

        // when / then
        assertThat(read("/api/my/door-codes")).as("a disabled account opens no door").isEqualTo("[]");
    }

    @Test
    void givenAnAdministratorWithTheExternalRoleAndABooking_whenReadingTheDoorCodes_thenTheListIsEmpty()
            throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID maryAccount = identity.createEnabledAccount(mary, "major.mary", Set.of(Role.EXTERNAL, Role.ADMIN));
        bookings.insertBookingThatHasStarted(court, winterDoubles, EVENING, maryAccount);

        // when / then
        assertThat(read("/api/my/door-codes", "major.mary"))
                .as("an administrator is no outsider and reads the codes only as a current member").isEqualTo("[]");
    }

    @Test
    void givenABookingOnACourtBesideTheHallDoor_whenTheBookerReadsIt_thenOnlyTheCourtGateCodeComesWithIt()
            throws Exception {
        // given
        UUID booking = book(winterDoubles);

        // when
        String page = read("/api/my/bookings");

        // then
        assertThat(JsonPath.<List<String>>read(page,
                "$.items[?(@.id == '" + booking + "')].access.codes[*].code"))
                .as("a door open to members sits in the pinned door codes, not in each booking")
                .containsExactly(NORTH_CODE);
    }

    private UUID book(UUID cardId) {
        return bookings.createBookingWithGuest(court, cardId, EVENING, johnAccount, john, Set.of(Role.EXTERNAL),
                null, "Mary Major");
    }

    private String read(String path) throws Exception {
        return read(path, "roe.john");
    }

    private String read(String path, String username) throws Exception {
        return mockMvc.perform(get(path).with(SecurityMockMvcRequestPostProcessors.user(
                        userDetails.loadUserByUsername(username))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
