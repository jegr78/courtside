package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
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
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, BookingTestFixture.class,
        CardTestFixture.class})
class AccessCodeVisibilityTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String NORTH_CODE = "135790";
    private static final String SOUTH_CODE = "246802";
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));

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
    private BookingService bookingService;

    private MockMvc mockMvc;
    private List<UUID> courts;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void aClubWithTwoGatesInFrontOfFourCourts() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courts = List.of(facility.createCourt(1, "Court 1"), facility.createCourt(2, "Court 2"),
                facility.createCourt(3, "Court 3"), facility.createCourt(4, "Court 4"));
        facility.createAccessPoint("North gate", courts.subList(0, 2), NORTH_CODE);
        facility.createAccessPoint("South gate", courts.subList(2, 4), SOUTH_CODE);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenABookingOnCourtTwo_whenTheBookerReadsIt_thenTheFirstGatesCodeComesWithItsWindow() throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(courts.get(1), MEMBER_BOOKING_CARD, EVENING,
                janeAccount, jane, Set.of(Role.MEMBER), null, john);

        // when
        String page = read("/api/my/bookings", "doe.jane");

        // then
        assertThat(codesOf(page, booking)).as("court 2 lies behind the north gate only").containsExactly(NORTH_CODE);
        assertThat(JsonPath.<List<String>>read(page, "$.items[?(@.id == '" + booking + "')].access.validFrom"))
                .as("the code opens fifteen minutes before play").containsExactly("2026-05-12T15:45:00Z");
        assertThat(JsonPath.<List<String>>read(page, "$.items[?(@.id == '" + booking + "')].access.validUntil"))
                .as("and closes fifteen minutes after it").containsExactly("2026-05-12T17:15:00Z");
    }

    @Test
    void givenABookingOnCourtsTwoAndThree_whenTheBookerReadsIt_thenItCarriesTheCodesOfBothGates() throws Exception {
        // given
        UUID booking = bookingService.create(new CreateBookingCommand(courts.subList(1, 3), MEMBER_BOOKING_CARD,
                EVENING, janeAccount, jane, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(john)), null));

        // when
        String page = read("/api/my/bookings", "doe.jane");

        // then
        assertThat(codesOf(page, booking)).as("the union of both courts' access points")
                .containsExactly(NORTH_CODE, SOUTH_CODE);
    }

    @Test
    void givenACardThatGrantsNoAccess_whenTheBookerReadsTheBooking_thenItCarriesNoCode() throws Exception {
        // given
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, false);
        UUID booking = bookings.createBookingNamingMember(courts.get(1), MEMBER_BOOKING_CARD, EVENING,
                janeAccount, jane, Set.of(Role.MEMBER), null, john);

        // when
        String page = read("/api/my/bookings", "doe.jane");

        // then
        assertThat(JsonPath.<List<Object>>read(page, "$.items[?(@.id == '" + booking + "')]")).hasSize(1);
        assertThat(page).as("a card that grants no access hands out no code").doesNotContain(NORTH_CODE);
    }

    @Test
    void givenAPlayerNamedInTheBooking_whenTheyReadTheirParticipations_thenTheyGetTheCodeToo() throws Exception {
        // given
        UUID booking = bookings.createBookingNamingMember(courts.get(1), MEMBER_BOOKING_CARD, EVENING,
                janeAccount, jane, Set.of(Role.MEMBER), null, john);

        // when
        String page = read("/api/my/participations", "roe.john");

        // then
        assertThat(codesOf(page, booking)).as("everyone playing needs to get through the gate")
                .containsExactly(NORTH_CODE);
    }

    @Test
    void givenAGuardianOfTheBooker_whenTheyReadTheDependantsBookings_thenTheCodeIsThere() throws Exception {
        // given
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.MEMBER));
        members.linkGuardian(mary, john, Set.of(GuardianGrant.VIEW_BOOKINGS));
        UUID booking = bookings.createBookingWithGuest(courts.getFirst(), MEMBER_BOOKING_CARD, EVENING,
                johnAccount, john, Set.of(Role.MEMBER), null, "Partner");

        // when
        String page = read("/api/my/dependants/" + john + "/bookings", "major.mary");

        // then
        assertThat(codesOf(page, booking)).containsExactly(NORTH_CODE);
    }

    @Test
    void givenABookingWithACode_whenAnyoneOutsideItLooks_thenNoViewTheyReachCarriesTheCode() throws Exception {
        // given
        UUID richard = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(richard, "miles.richard", Set.of(Role.values()));
        UUID booking = bookings.createBookingNamingMember(courts.get(1), MEMBER_BOOKING_CARD, EVENING,
                janeAccount, jane, Set.of(Role.MEMBER), null, john);

        // when
        List<String> pages = List.of(
                read("/api/managed/bookings", "miles.richard"),
                read("/api/managed/bookings/" + booking, "miles.richard"),
                read("/api/public/booking-grid?from=2026-05-12&to=2026-05-12", "miles.richard"),
                read("/api/my/bookings", "miles.richard"),
                read("/api/my/participations", "miles.richard"));

        // then
        assertThat(pages.get(0)).as("the managed list is reachable and lists the booking").contains(booking.toString());
        assertThat(pages).as("the managed view, the public plan and another member's own lists carry no code")
                .allSatisfy(page -> assertThat(page).doesNotContain(NORTH_CODE));
    }

    @Test
    void givenABookingWhoseWindowHasEnded_whenTheBookerReadsTheHistory_thenTheCodeIsGone() throws Exception {
        // given
        UUID ended = bookings.insertBookingThatHasStarted(courts.get(1), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T08:00:00Z"), Instant.parse("2026-05-12T09:00:00Z")),
                janeAccount);
        UUID running = bookings.insertBookingThatHasStarted(courts.get(2), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T08:50:00Z"), Instant.parse("2026-05-12T09:50:00Z")),
                janeAccount);

        // when
        String history = read("/api/my/bookings?view=HISTORY", "doe.jane");
        String upcoming = read("/api/my/bookings", "doe.jane");

        // then
        assertThat(JsonPath.<List<Object>>read(history, "$.items[?(@.id == '" + ended + "')]"))
                .as("the ended booking is still listed").hasSize(1);
        assertThat(history + upcoming).as("its window closed at 09:15, before the clock's 10:00")
                .doesNotContain(NORTH_CODE);
        assertThat(Stream.concat(codesOf(history, running).stream(), codesOf(upcoming, running).stream()))
                .as("a booking that ended ten minutes ago still opens the gate until 10:05")
                .containsExactly(SOUTH_CODE);
    }

    private String read(String path, String username) throws Exception {
        return mockMvc.perform(get(path).with(as(username)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static List<String> codesOf(String page, UUID booking) {
        return JsonPath.read(page, "$.items[?(@.id == '" + booking + "')].access.codes[*].code");
    }

    private RequestPostProcessor as(String username) {
        return SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername(username));
    }
}
