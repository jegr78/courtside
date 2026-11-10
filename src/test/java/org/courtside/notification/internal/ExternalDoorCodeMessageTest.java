package org.courtside.notification.internal;

import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
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
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

class ExternalDoorCodeMessageTest extends AbstractIntegrationTest {

    private static final String OLD_CODE = "135790";
    private static final String NEW_CODE = "975310";
    private static final String NORTH_CODE = "246802";
    private static final String HALL_CODE = "864200";
    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

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
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    private UUID court;
    private UUID clubhouseDoor;
    private UUID winterDoubles;

    @BeforeEach
    void aClubhouseDoorOpenToMembersAndACardOpenToExternalPlayers() {
        doNothing().when(sender).send(any(MimeMessage.class));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        clubhouseDoor = facility.createAccessPoint("Clubhouse door", List.of(), OLD_CODE, true);
        config.admitExternalBookings(true);
        winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        cards.letBookingsReceiveAccessCodes(winterDoubles, true);
        jdbc.sql("DELETE FROM message_record").update();
        jdbc.sql("DELETE FROM notification").update();
    }

    @Test
    void givenAnExternalPlayerWithAnUpcomingBooking_whenTheClubhouseCodeChanges_thenTheyAreToldTheNewCode()
            throws Exception {
        // given
        UUID booker = externalPlayerBooking("John", "Roe").account();
        externalPlayer("Mary", "Major");

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);
        outbox.deliverDue();

        // then
        assertThat(told("MEMBERS_DOOR_CODE_CHANGED")).as("only the external player who holds a booking")
                .containsExactly(booker);
        assertThat(bodyTo("john.roe@example.org")).as("the booking's own mails never carried the door's code")
                .contains("Clubhouse door: " + NEW_CODE).doesNotContain(OLD_CODE);
    }

    @Test
    void givenADisabledExternalPlayerWithABooking_whenTheClubhouseCodeChanges_thenTheyAreNotTold() {
        // given
        identity.disableAccount(externalPlayerBooking("John", "Roe").account());

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);

        // then
        assertThat(told("MEMBERS_DOOR_CODE_CHANGED")).as("a disabled account receives no door code").isEmpty();
    }

    @Test
    void givenAMemberWhoAlsoHoldsABooking_whenTheClubhouseCodeChanges_thenTheyAreToldOnce() {
        // given
        Booked booked = externalPlayerBooking("John", "Roe");
        members.holdRunningMembership(identity.personIdForUsername("roe.john"));

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);

        // then
        assertThat(told("MEMBERS_DOOR_CODE_CHANGED")).as("the member walk tells them, the booker walk skips them")
                .containsExactly(booked.account());
    }

    @Test
    void givenMoreExternalBookersThanOnePage_whenTheClubhouseCodeChanges_thenEachOfThemIsToldOnce() {
        // given
        List<UUID> booked = new ArrayList<>();
        for (int i = 0; i < 101; i++) {
            UUID account = externalPlayer("Mary" + (char) ('a' + i / 26) + (char) ('a' + i % 26), "Major");
            Instant start = EVENING.start().plus(Duration.ofDays(i + 1));
            bookings.insertBookingThatHasStarted(court, winterDoubles,
                    new TimeSlot(start, start.plus(Duration.ofHours(1))), account);
            booked.add(account);
        }

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);

        // then
        assertThat(told("MEMBERS_DOOR_CODE_CHANGED")).as("the booker walk continues past its first page of a hundred")
                .containsExactlyInAnyOrderElementsOf(booked);
    }

    @Test
    void givenAQueuedMessage_whenTheExternalPlayerCancelsBeforeItsTurn_thenItFailsUnsent() {
        // given
        Booked booked = externalPlayerBooking("John", "Roe");
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);
        bookings.cancelBooking(booked.booking(), booked.account(), Set.of(Role.EXTERNAL));

        // when
        outbox.deliverDue();

        // then
        assertThat(jdbc.sql("SELECT state, reason FROM message_record WHERE kind = 'MEMBERS_DOOR_CODE_CHANGED'")
                .query().singleRow())
                .as("a player without a booking is not handed the door code")
                .containsEntry("state", "FAILED").containsEntry("reason", "NoLongerEntitled");
    }

    @Test
    void givenADoorOpenToMembersBesideABookedCourt_whenItsCodeChanges_thenTheBookingIsNotToldAboutIt() {
        // given
        facility.createAccessPoint("North gate", List.of(court), NORTH_CODE);
        UUID hallDoor = facility.createAccessPoint("Hall door", List.of(court), HALL_CODE, true);
        externalPlayerBooking("John", "Roe");

        // when
        facility.changeAccessPoint(hallDoor, "Hall door", List.of(court), NEW_CODE, true);

        // then
        assertThat(told("ACCESS_CODE_CHANGED")).as("the booking carries no code of a door open to members")
                .isEmpty();
    }

    @Test
    void givenADoorOpenToMembersBesideABookedCourt_whenItIsNoLongerOpenToMembers_thenTheBookingIsToldItsCode() {
        // given
        UUID hallDoor = facility.createAccessPoint("Hall door", List.of(court), NEW_CODE, true);
        UUID booker = externalPlayerBooking("John", "Roe").account();

        // when
        facility.changeAccessPoint(hallDoor, "Hall door", List.of(court), NEW_CODE, false);

        // then
        assertThat(told("ACCESS_CODE_CHANGED")).as("the door now opens the court for the booking instead")
                .containsExactly(booker);
    }

    private Booked externalPlayerBooking(String firstName, String lastName) {
        UUID account = externalPlayer(firstName, lastName);
        UUID person = identity.personIdForUsername((lastName + "." + firstName).toLowerCase());
        UUID booking = bookings.createBookingWithGuest(court, winterDoubles, EVENING, account, person,
                Set.of(Role.EXTERNAL), null, "Richard Miles");
        return new Booked(account, booking);
    }

    private UUID externalPlayer(String firstName, String lastName) {
        UUID person = identity.createPerson(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org");
        return identity.createEnabledAccount(person, (lastName + "." + firstName).toLowerCase(),
                Set.of(Role.EXTERNAL));
    }

    private List<UUID> told(String kind) {
        return jdbc.sql("SELECT account_id FROM message_record WHERE kind = :kind")
                .param("kind", kind).query(UUID.class).list();
    }

    private String bodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(1)).send(captured.capture());
        StringBuilder bodies = new StringBuilder();
        for (MimeMessage message : captured.getAllValues()) {
            if (address.equals(message.getAllRecipients()[0].toString())) {
                bodies.append(text(message.getContent())).append('\n');
            }
        }
        return bodies.toString();
    }

    private static String text(Object content) throws Exception {
        if (!(content instanceof Multipart multipart)) {
            return content.toString();
        }
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < multipart.getCount(); i++) {
            text.append(text(multipart.getBodyPart(i).getContent()));
        }
        return text.toString();
    }

    private record Booked(UUID account, UUID booking) {
    }
}
