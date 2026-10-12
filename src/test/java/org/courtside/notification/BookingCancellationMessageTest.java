package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class})
class BookingCancellationMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    private SentMail mail;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;
    private UUID playerPersonId;
    private UUID playerAccountId;
    private UUID boardAccountId;

    @BeforeEach
    void aBookingWithACoPlayerAndABoard() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
        boardAccountId = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles", "richard.miles@example.org"), "miles.richard",
                Set.of(Role.ADMIN));
    }

    @Test
    void givenACoPlayer_whenTheBookerCancels_thenTheCoPlayerIsToldAndTheBookerIsNot() throws Exception {
        // given
        UUID bookingId = book();
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, bookerAccountId, Set.of(Role.MEMBER));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .as("the co-player hears of the cancellation in the centre")
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_CANCELLED);
        assertThat(notifications.mailsQueuedFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_CANCELLED);
        assertThat(notifications.notificationsFor(bookerAccountId))
                .as("whoever cancelled their own booking already knows")
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
        assertThat(stateOf(playerAccountId, MessageKind.BOOKING_CANCELLED))
                .as("a cancellation notice is composed although its booking is cancelled")
                .isEqualTo("HANDED_OVER");
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .contains("Mittwoch, 13. Mai 2026", "18:00", "19:00", "Court 1", "storniert")
                .doesNotContain("Jane").doesNotContain("Doe");
    }

    @Test
    void givenACoPlayer_whenTheBoardCancels_thenTheBookerAndTheCoPlayerAreToldItWasTheClub() throws Exception {
        // given
        UUID bookingId = book();
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(notifications.notificationsFor(bookerAccountId))
                .containsExactly(MessageKind.BOOKING_CONFIRMED, MessageKind.BOOKING_CANCELLED_BY_CLUB);
        assertThat(notifications.notificationsFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_CANCELLED_BY_CLUB);
        assertThat(notifications.notificationsFor(boardAccountId))
                .as("the board account that cancelled is not told what it did")
                .isEmpty();
        assertThat(stateOf(bookerAccountId, MessageKind.BOOKING_CANCELLED_BY_CLUB)).isEqualTo("HANDED_OVER");
        assertThat(mail.bodiesTo("jane.doe@example.org")).singleElement().asString()
                .contains("hat diese Buchung storniert", "Mittwoch, 13. Mai 2026", "Court 1")
                .doesNotContain("Richard").doesNotContain("Miles");
    }

    @Test
    void givenAnEnglishSpeakingCoPlayer_whenTheBoardCancels_thenTheyAreToldInEnglish() throws Exception {
        // given
        UUID bookingId = book();
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", playerAccountId).update();
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .contains("has cancelled this booking", "Wednesday, May 13, 2026", "Court 1");
    }

    @Test
    void givenACoPlayerWhoDeclinedCancellations_whenTheBookerCancels_thenTheyReceiveNothing() throws Exception {
        // given
        UUID bookingId = book();
        notifications.decline(playerAccountId, MessageKind.BOOKING_CANCELLED);
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, bookerAccountId, Set.of(Role.MEMBER));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .as("a declined kind reaches neither the centre nor the mail")
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED);
        assertThat(notifications.mailsQueuedFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED);
    }

    @Test
    void givenACoPlayerWhoSwitchedEmailOff_whenTheBoardCancels_thenOnlyTheCentreTellsThem() {
        // given
        UUID bookingId = book();
        notifications.declineEmail(playerAccountId);

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_CANCELLED_BY_CLUB);
        assertThat(notifications.mailsQueuedFor(playerAccountId))
                .as("the channel choice stops the mail of a kind that cannot be declined")
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED);
    }

    @Test
    void givenACancelledBooking_whenItIsCancelledAgain_thenNobodyIsToldTwice() {
        // given
        UUID bookingId = book();
        bookings.cancel(bookingId, bookerAccountId, Set.of(Role.MEMBER));

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(notifications.notificationsFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_CANCELLED);
        assertThat(notifications.notificationsFor(bookerAccountId))
                .containsExactly(MessageKind.BOOKING_CONFIRMED);
    }

    @Test
    void whenTheBoardCancels_thenTheCentreKeepsOnlyTheBookingAndNobodyWhoActed() {
        // given
        UUID bookingId = book();

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(jdbc.sql("""
                        SELECT parameters::text FROM notification
                        WHERE kind = 'BOOKING_CANCELLED_BY_CLUB'
                        """).query(String.class).list())
                .hasSize(2)
                .containsOnly("{\"bookingId\": \"" + bookingId + "\"}");
    }

    @Test
    void givenAReason_whenTheBoardCancels_thenEveryoneToldReadsItInTheirLanguageAndTheCentreKeepsTheCode()
            throws Exception {
        // given
        UUID bookingId = book();
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", playerAccountId).update();
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN), CancellationReason.MAINTENANCE);

        // then
        assertThat(mail.bodiesTo("jane.doe@example.org")).singleElement().asString()
                .contains("Grund: Wartungsarbeiten.")
                .doesNotContain("Frage deinen Verein");
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .contains("Reason: maintenance work.");
        assertThat(jdbc.sql("SELECT parameters::text FROM notification WHERE kind = 'BOOKING_CANCELLED_BY_CLUB'")
                .query(String.class).list())
                .as("the centre keeps the code, never a sentence")
                .containsOnly("{\"reason\": \"MAINTENANCE\", \"bookingId\": \"" + bookingId + "\"}");
        assertThat(jdbc.sql("SELECT cancellation_reason FROM booking WHERE id = :id").param("id", bookingId)
                .query(String.class).single())
                .isEqualTo("MAINTENANCE");
    }

    @Test
    void givenNoReason_whenTheBoardCancels_thenTheMessageSendsTheMemberToTheClub() throws Exception {
        // given
        UUID bookingId = book();
        clearInvocations(sender);

        // when
        bookings.cancel(bookingId, boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(mail.bodiesTo("jane.doe@example.org")).singleElement().asString()
                .contains("Frage deinen Verein, wenn du den Grund wissen möchtest.")
                .doesNotContain("Grund:");
    }

    @Test
    void givenAReason_whenTheHolderCancelsTheirOwnBooking_thenNothingIsCancelledOrSent() {
        // given
        UUID bookingId = book();

        // when / then
        assertThatThrownBy(() -> bookings.cancel(bookingId, bookerAccountId, Set.of(Role.MEMBER),
                CancellationReason.WEATHER))
                .isInstanceOfSatisfying(CodedDomainFailure.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("booking.cancellationReason.ownBooking"));
        assertThat(jdbc.sql("SELECT status FROM booking WHERE id = :id").param("id", bookingId)
                .query(String.class).single())
                .as("a refused reason refuses the cancellation it came with")
                .isEqualTo("CONFIRMED");
        assertThat(notifications.notificationsFor(playerAccountId))
                .containsExactly(MessageKind.BOOKING_PLAYER_RECORDED);
    }

    private UUID book() {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId)), null));
    }

    private String stateOf(UUID accountId, MessageKind kind) {
        return jdbc.sql("SELECT state FROM message_record WHERE account_id = :accountId AND kind = :kind")
                .param("accountId", accountId)
                .param("kind", kind.name())
                .query(String.class)
                .single();
    }
}
