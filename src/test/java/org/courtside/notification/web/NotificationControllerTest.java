package org.courtside.notification.web;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
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
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class})
class NotificationControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-12T18:00:00Z");
    private static final Instant EARLIER = Instant.parse("2026-05-12T09:00:00Z");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final String NOT_FOUND = "urn:courtside:error:notification-not-found";

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private SqlStatementCounter queries;

    private MockMvc mockMvc;
    private UUID courtId;
    private UUID janePersonId;
    private UUID janeAccountId;
    private UUID johnPersonId;
    private UUID johnAccountId;

    @BeforeEach
    void twoMembersWhoCanBook() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        janePersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccountId = identity.createEnabledAccount(janePersonId, "doe.jane", Set.of(Role.MEMBER));
        johnPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccountId = identity.createEnabledAccount(johnPersonId, "roe.john", Set.of(Role.MEMBER));
    }

    @AfterEach
    void stopCounting() {
        queries.pause();
    }

    @Test
    void givenNotificationsForTwoMembers_whenOneReadsTheCentre_thenOnlyTheirOwnAreServedWithContentAndLink()
            throws Exception {
        // given
        UUID janesBooking = book(janeAccountId, janePersonId, SIX_PM, SEVEN_PM);
        book(johnAccountId, johnPersonId, SEVEN_PM, EIGHT_PM);

        // when / then
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].kind").value("BOOKING_CONFIRMED"))
                .andExpect(jsonPath("$.items[0].createdAt").exists())
                .andExpect(jsonPath("$.items[0].readAt").value(nullValue()))
                .andExpect(jsonPath("$.items[0].booking.startsAt").value("2026-05-12T16:00:00Z"))
                .andExpect(jsonPath("$.items[0].booking.endsAt").value("2026-05-12T17:00:00Z"))
                .andExpect(jsonPath("$.items[0].booking.courts[0].number").value(1))
                .andExpect(jsonPath("$.items[0].booking.courts[0].name").value("Court 1"))
                .andExpect(jsonPath("$.items[0].booking.cancelled").value(false))
                .andExpect(jsonPath("$.items[0].link.target").value("BOOKINGS"))
                .andExpect(jsonPath("$.items[0].link.bookingId").value(janesBooking.toString()))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void givenAPlayerStillInABooking_whenTheyReadTheCentre_thenTheEntryDescribesAndLinksTheBooking()
            throws Exception {
        // given
        UUID janesBooking = bookNaming(johnPersonId, SIX_PM, SEVEN_PM);

        // when / then
        mockMvc.perform(get("/api/account/notifications").with(as("roe.john")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].kind").value("BOOKING_PLAYER_RECORDED"))
                .andExpect(jsonPath("$.items[0].booking.startsAt").value("2026-05-12T16:00:00Z"))
                .andExpect(jsonPath("$.items[0].booking.cardLabel").exists())
                .andExpect(jsonPath("$.items[0].link.bookingId").value(janesBooking.toString()));
    }

    @Test
    void givenAPlayerWhoLeftTheBooking_whenTheyReadTheCentre_thenTheEntryNoLongerDescribesOrLinksIt()
            throws Exception {
        // given
        UUID janesBooking = bookNaming(johnPersonId, SIX_PM, SEVEN_PM);
        participations.withdraw(janesBooking, johnPersonId, johnAccountId);

        // when / then
        mockMvc.perform(get("/api/account/notifications").with(as("roe.john")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].kind").value("BOOKING_PLAYER_RECORDED"))
                .andExpect(jsonPath("$.items[0].booking").doesNotExist())
                .andExpect(jsonPath("$.items[0].link.target").value("BOOKINGS"))
                .andExpect(jsonPath("$.items[0].link.bookingId").doesNotExist());
    }

    @Test
    void givenEntriesAboutManyBookings_whenTheCentreIsRead_thenTheStatementsDoNotGrowWithThePage()
            throws Exception {
        // given
        notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER,
                book(janeAccountId, janePersonId, SIX_PM, SEVEN_PM), EARLIER);
        queries.reset();
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane"))).andExpect(status().isOk());
        long oneEntry = queries.snapshot().total();
        queries.pause();
        for (int hour = 1; hour < 3; hour++) {
            Instant from = SIX_PM.plusSeconds(3_600L * hour);
            notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER,
                    book(janeAccountId, janePersonId, from, from.plusSeconds(3_600)), EARLIER);
        }

        // when
        queries.reset();
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[5].booking.startsAt").exists());
        var manyEntries = queries.snapshot();
        queries.pause();

        // then
        assertThat(manyEntries.total()).as("a page of many entries costs what one costs: " + manyEntries)
                .isEqualTo(oneEntry);
    }

    @Test
    void givenSignInHelp_whenTheCentreIsRead_thenItLinksToTheAccountPageAndNamesNoBooking() throws Exception {
        // given
        notifications.notify(janeAccountId, MessageKind.ACCOUNT_USERNAME_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].kind").value("ACCOUNT_USERNAME_REMINDER"))
                .andExpect(jsonPath("$.items[0].booking").doesNotExist())
                .andExpect(jsonPath("$.items[0].link.target").value("ACCOUNT_SECURITY"))
                .andExpect(jsonPath("$.items[0].link.bookingId").doesNotExist());
    }

    @Test
    void givenANotificationWhoseBookingIsGone_whenTheCentreIsRead_thenItIsListedWithoutContentItCannotResolve()
            throws Exception {
        // given
        notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, UUID.randomUUID(), EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].kind").value("BOOKING_REMINDER"))
                .andExpect(jsonPath("$.items[0].booking").doesNotExist())
                .andExpect(jsonPath("$.items[0].link.target").value("BOOKINGS"))
                .andExpect(jsonPath("$.items[0].link.bookingId").doesNotExist());
    }

    @Test
    void givenThreeNotifications_whenReadTwoAtATime_thenTheSecondPageContinuesNewestFirstWithoutRepeating()
            throws Exception {
        // given
        UUID first = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        UUID second = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        UUID third = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications").param("limit", "2").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(third.toString()))
                .andExpect(jsonPath("$.items[1].id").value(second.toString()))
                .andExpect(jsonPath("$.nextCursor").value(second.toString()));
        mockMvc.perform(get("/api/account/notifications").param("limit", "2")
                        .param("cursor", second.toString()).with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(first.toString()))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void givenUnreadEntriesBeyondThePage_whenAMemberReadsOnePage_thenTheUnreadCountCoversAllOfTheirsAndNoOneElses()
            throws Exception {
        // given
        UUID oldest = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        UUID read = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        notifications.markRead(read, EARLIER);
        UUID newest = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        notifications.notify(johnAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications").param("limit", "1").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(newest.toString()))
                .andExpect(jsonPath("$.unread").value(2));
        mockMvc.perform(get("/api/account/notifications").param("limit", "1")
                        .param("cursor", newest.toString()).with(as("doe.jane")))
                .andExpect(jsonPath("$.unread").value(2));
        mockMvc.perform(post("/api/account/notifications/{id}/read", oldest).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/account/notifications").param("limit", "1").with(as("doe.jane")))
                .andExpect(jsonPath("$.unread").value(1));
    }

    @Test
    void givenAnotherMembersNotificationAsCursor_whenAMemberPagesOnFromIt_thenThePageIsEmpty() throws Exception {
        // given
        notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        UUID johns = notifications.notify(johnAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications").param("cursor", johns.toString()).with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void givenAnUnreadNotification_whenItsMemberMarksItRead_thenItCarriesTheTime() throws Exception {
        // given
        UUID own = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when
        mockMvc.perform(post("/api/account/notifications/{id}/read", own).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(notifications.readAt(own)).as("marking stores when it was read").isEqualTo(NOW);
        mockMvc.perform(get("/api/account/notifications").with(as("doe.jane")))
                .andExpect(jsonPath("$.items[0].readAt").value("2026-05-12T10:00:00Z"));
    }

    @Test
    void givenANotificationReadEarlier_whenItIsMarkedAgain_thenItKeepsTheTimeItWasFirstRead() throws Exception {
        // given
        UUID own = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);
        notifications.markRead(own, EARLIER);

        // when
        mockMvc.perform(post("/api/account/notifications/{id}/read", own).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(notifications.readAt(own)).as("a second mark keeps the first time").isEqualTo(EARLIER);
    }

    @Test
    void givenAnotherMembersNotification_whenAMemberMarksItRead_thenItIsNotFoundAndStaysUnread() throws Exception {
        // given
        UUID johns = notifications.notify(johnAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(post("/api/account/notifications/{id}/read", johns).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value(NOT_FOUND))
                .andExpect(jsonPath("$.detail").value("No notification with this id is addressed to you"))
                .andExpect(jsonPath("$.violations[0].code").value("notification.notFound"));
        assertThat(notifications.readAt(johns)).as("another member's entry stays unread").isNull();
    }

    @Test
    void whenAMemberMarksAnIdNobodyHolds_thenItIsNotFoundTheSameWay() throws Exception {
        // when / then
        mockMvc.perform(post("/api/account/notifications/{id}/read", UUID.randomUUID())
                        .with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value(NOT_FOUND));
    }

    @Test
    void whenNobodyIsSignedIn_thenTheCentreIsNotServedAndNothingIsMarked() throws Exception {
        // given
        UUID own = notifications.notify(janeAccountId, MessageKind.BOOKING_REMINDER, null, EARLIER);

        // when / then
        mockMvc.perform(get("/api/account/notifications")).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/account/notifications/{id}/read", own).with(csrf()))
                .andExpect(status().isUnauthorized());
        assertThat(notifications.readAt(own)).isNull();
    }

    @Test
    void givenAMemberWhoChoseNoChannel_whenTheyReadTheirChannels_thenEmailIsOn() throws Exception {
        // when / then
        mockMvc.perform(get("/api/account/messages/channels").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].channel").value("EMAIL"))
                .andExpect(jsonPath("$[0].enabled").value(true));
    }

    @Test
    void givenEmailSwitchedOff_whenItIsSwitchedOnAgain_thenTheChannelsFollowAndTheKindsStayUntouched()
            throws Exception {
        // given
        notifications.decline(janeAccountId, MessageKind.BOOKING_REMINDER);
        chooseChannels("[\"EMAIL\"]");
        mockMvc.perform(get("/api/account/messages/channels").with(as("doe.jane")))
                .andExpect(jsonPath("$[0].enabled").value(false));

        // when
        chooseChannels("[]");

        // then
        mockMvc.perform(get("/api/account/messages/channels").with(as("doe.jane")))
                .andExpect(jsonPath("$[0].enabled").value(true));
        mockMvc.perform(get("/api/account/messages").with(as("doe.jane")))
                .andExpect(jsonPath("$[?(@.kind == 'BOOKING_REMINDER' && @.enabled == false)]", hasSize(1)));
    }

    @Test
    void whenAChannelNobodyOffersIsDeclined_thenItIsRefusedNamingTheField() throws Exception {
        // when / then
        mockMvc.perform(put("/api/account/messages/channels").with(as("doe.jane")).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": [\"CARRIER_PIGEON\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"));
        mockMvc.perform(get("/api/account/messages/channels").with(as("doe.jane")))
                .andExpect(jsonPath("$[0].enabled").value(true));
    }

    private void chooseChannels(String declined) throws Exception {
        mockMvc.perform(put("/api/account/messages/channels").with(as("doe.jane")).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"declined\": " + declined + "}"))
                .andExpect(status().isNoContent());
    }

    private UUID bookNaming(UUID playerPersonId, Instant from, Instant to) {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, to), janeAccountId, janePersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId)), null));
    }

    private UUID book(UUID accountId, UUID personId, Instant from, Instant to) {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, to), accountId, personId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.guest("Richard Miles")), null));
    }

    private static RequestPostProcessor as(String username) {
        return user(username).roles("MEMBER");
    }
}
