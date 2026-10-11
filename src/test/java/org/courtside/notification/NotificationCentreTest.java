package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.BookingReminderDue;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.UsernameReminderRequested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class})
class NotificationCentreTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

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
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;

    @BeforeEach
    void aMemberWhoCanBook() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenAMemberWhoChoseNothing_whenTheyBook_thenTheCentreHoldsTheConfirmationAndTheMailIsQueued() {
        // when
        UUID bookingId = book(List.of(ParticipantSpec.guest("Richard Miles")));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .as("the centre holds the confirmation")
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
        assertThat(notifications.mailsQueuedFor(bookerAccountId))
                .as("email is on until the member switches it off")
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
        assertThat(storedParameters(bookerAccountId))
                .as("the entry names the booking and nothing else")
                .containsExactly("{\"bookingId\": \"" + bookingId + "\"}");
    }

    @Test
    void givenAPlayerWhoLeavesABooking_whenTheBookerIsTold_thenTheEntryNamesTheBookingAndNotThePlayer() {
        // given
        UUID playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
        UUID bookingId = book(List.of(ParticipantSpec.member(playerPersonId)));

        // when
        participations.withdraw(bookingId, playerPersonId, identity.accountIdOf(playerPersonId));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .containsExactly(MessageKind.BOOKING_CONFIRMED, MessageKind.BOOKING_PLAYER_WITHDREW);
        assertThat(storedParameters(bookerAccountId))
                .as("the centre keeps no identifier of the player who left")
                .containsOnly("{\"bookingId\": \"" + bookingId + "\"}");
    }

    @Test
    void givenAPlayerWithoutAnAddress_whenTheyAreWrittenIntoABooking_thenTheCentreHoldsItAndNoMailIsQueued() {
        // given
        UUID playerPersonId = identity.createPerson("John", "Roe", "");
        UUID playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));

        // when
        book(List.of(ParticipantSpec.member(playerPersonId)));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .as("a member without an address still learns they were written into a booking")
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED);
        assertThat(notifications.mailsQueuedFor(playerAccountId))
                .as("nothing is queued for an address that does not exist")
                .isEmpty();
    }

    @Test
    void givenAPlayerWithoutAnAddress_whenTheirBookingIsDueAndDisplaced_thenTheCentreTellsThemBoth() {
        // given
        UUID playerPersonId = identity.createPerson("John", "Roe", "");
        UUID playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
        UUID bookingId = book(List.of(ParticipantSpec.member(playerPersonId)));

        // when
        transactions.executeWithoutResult(status -> {
            events.publishEvent(new BookingReminderDue(bookingId));
            events.publishEvent(new BookingDisplaced(bookingId, BookingDisplaced.Closure.DAY_CLOSED));
        });

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .as("every enabled player hears of their booking, with or without an address")
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_REMINDER,
                        MessageKind.BOOKING_DISPLACED);
        assertThat(notifications.mailsQueuedFor(playerAccountId)).isEmpty();
    }

    @Test
    void givenAMemberWhoSwitchedEmailOff_whenTheyBook_thenTheCentreHoldsTheConfirmationAndNoMailIsQueued() {
        // given
        notifications.declineEmail(bookerAccountId);

        // when
        book(List.of(ParticipantSpec.guest("Richard Miles")));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .as("switching email off keeps the kind")
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
        assertThat(notifications.mailsQueuedFor(bookerAccountId))
                .as("switching email off stops the mail")
                .isEmpty();
    }

    @Test
    void givenAMemberWhoSwitchedEmailOff_whenTheirBookingIsDisplaced_thenOnlyTheCentreTellsThem() {
        // given
        UUID bookingId = book(List.of(ParticipantSpec.guest("Richard Miles")));
        notifications.declineEmail(bookerAccountId);

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new BookingDisplaced(bookingId, BookingDisplaced.Closure.COURT_OUT_OF_SERVICE)));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .as("a notice that cannot be switched off still reaches the centre")
                .containsExactly(MessageKind.BOOKING_CONFIRMED, MessageKind.BOOKING_DISPLACED);
        assertThat(notifications.mailsQueuedFor(bookerAccountId))
                .as("with email off the displacement is not mailed; only the earlier confirmation was")
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
    }

    @Test
    void givenAMemberWhoDeclinedTheKind_whenTheyBook_thenNeitherTheCentreNorTheMailHoldsIt() {
        // given
        notifications.decline(bookerAccountId, MessageKind.BOOKING_CONFIRMED);

        // when
        book(List.of(ParticipantSpec.guest("Richard Miles")));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .as("a declined kind is declined on every channel, the centre included")
                .isEmpty();
        assertThat(notifications.mailsQueuedFor(bookerAccountId)).isEmpty();
    }

    @Test
    void givenAMemberWhoSwitchedEmailOff_whenTheyAskForTheirUsername_thenItIsMailedAnyway() {
        // given
        notifications.declineEmail(bookerAccountId);

        // when
        transactions.executeWithoutResult(status ->
                events.publishEvent(new UsernameReminderRequested(bookerAccountId)));

        // then
        assertThat(notifications.mailsQueuedFor(bookerAccountId))
                .as("a signed-out member cannot read the centre, so sign-in help is always mailed")
                .containsExactly(MessageKind.ACCOUNT_USERNAME_REMINDER);
        assertThat(notifications.notificationsFor(bookerAccountId))
                .containsExactly(MessageKind.ACCOUNT_USERNAME_REMINDER);
    }

    @Test
    void givenADeactivatedPlayer_whenTheyAreWrittenIntoABooking_thenTheCentreHoldsNothingForThem() {
        // given
        UUID playerPersonId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID playerAccountId = identity.createEnabledAccount(playerPersonId, "major.mary", Set.of(Role.MEMBER));
        identity.disableAccount(playerAccountId);

        // when
        book(List.of(ParticipantSpec.member(playerPersonId)));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .as("somebody who has left the club is not written to")
                .isEmpty();
    }

    @Test
    void whenAnAccountsUnreadEntriesAreCounted_thenThePlannerReadsTheUnreadIndex() {
        // when
        String plan = transactions.execute(status -> {
            jdbc.sql("SET LOCAL enable_seqscan = off").update();
            return String.join("\n", jdbc.sql("""
                            EXPLAIN SELECT count(*) FROM notification
                            WHERE account_id = :accountId AND read_at IS NULL
                            """)
                    .param("accountId", bookerAccountId)
                    .query(String.class)
                    .list());
        });

        // then
        assertThat(plan).as("the unread count reads only the unread entries of one account")
                .contains("notification_unread_idx");
    }

    private UUID book(List<ParticipantSpec> players) {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, players, null));
    }

    private List<String> storedParameters(UUID accountId) {
        return jdbc.sql("SELECT parameters::text FROM notification WHERE account_id = :accountId ORDER BY created_seq")
                .param("accountId", accountId)
                .query(String.class)
                .list();
    }
}
