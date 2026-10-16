package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

@Import({BookingTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        NotificationTestFixture.class})
class BookingReleaseMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    private SentMail mail;

    @Autowired
    private BookingTestFixture bookings;

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
    void aClubThatReleasesUnattendedBookings() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        courtId = facility.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
        boardAccountId = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles", "richard.miles@example.org"), "miles.richard",
                Set.of(Role.ADMIN));
        bookings.trackAttendance(15);
    }

    @Test
    void givenNobodyCheckedIn_whenTheReleaseTimePasses_thenTheBookerAndThePlayerAreToldOnce() {
        // given
        startedMinutesAgo(20);

        // when
        int released = bookings.releaseUnattended();

        // then
        assertThat(released).isEqualTo(1);
        assertThat(notifications.notificationsFor(bookerAccountId)).containsExactly(MessageKind.BOOKING_RELEASED);
        assertThat(notifications.notificationsFor(playerAccountId)).containsExactly(MessageKind.BOOKING_RELEASED);
        assertThat(notifications.notificationsFor(boardAccountId))
                .as("only the people of the booking are told")
                .isEmpty();
        assertThat(stateOf(playerAccountId)).isEqualTo("HANDED_OVER");
        assertThat(mail.bodiesTo("jane.doe@example.org")).singleElement().asString()
                .contains("niemand rechtzeitig eingecheckt", "Dienstag, 12. Mai 2026", "Court 1");
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .contains("niemand rechtzeitig eingecheckt", "Court 1");
    }

    @Test
    void givenAnEnglishSpeakingPlayer_whenTheBookingIsReleased_thenTheyAreToldInEnglish() {
        // given
        startedMinutesAgo(20);
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", playerAccountId).update();

        // when
        bookings.releaseUnattended();

        // then
        assertThat(mail.bodiesTo("john.roe@example.org")).singleElement().asString()
                .contains("Nobody checked in", "Tuesday, May 12, 2026", "Court 1");
    }

    @Test
    void givenAPlayerWhoSwitchedEmailOff_whenTheBookingIsReleased_thenOnlyTheCentreTellsThem() {
        // given
        startedMinutesAgo(20);
        notifications.declineEmail(playerAccountId);

        // when
        bookings.releaseUnattended();

        // then
        assertThat(notifications.notificationsFor(playerAccountId)).containsExactly(MessageKind.BOOKING_RELEASED);
        assertThat(notifications.mailsQueuedFor(playerAccountId))
                .as("the channel choice stops the mail of a kind that cannot be declined")
                .isEmpty();
    }

    @Test
    void givenABookingWhoseReleaseTimeHasNotPassed_whenTheSweepRuns_thenNobodyIsTold() {
        // given
        startedMinutesAgo(10);

        // when
        int released = bookings.releaseUnattended();

        // then
        assertThat(released).isZero();
        assertThat(notifications.notificationsFor(bookerAccountId)).isEmpty();
        assertThat(notifications.notificationsFor(playerAccountId)).isEmpty();
        assertThat(mail.bodiesTo("john.roe@example.org")).isEmpty();
    }

    private void startedMinutesAgo(int minutes) {
        Instant start = NOW.minus(Duration.ofMinutes(minutes));
        UUID bookingId = bookings.insertBookingThatHasStarted(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(start, start.plus(Duration.ofHours(1))), bookerAccountId);
        addPlayer(bookingId, bookerPersonId, 0);
        addPlayer(bookingId, playerPersonId, 1);
    }

    private void addPlayer(UUID bookingId, UUID personId, int position) {
        jdbc.sql("""
                        INSERT INTO booking_participant (id, booking_id, kind, person_id, position)
                        VALUES (:id, :bookingId, 'MEMBER', :personId, :position)
                        """)
                .param("id", UUID.randomUUID()).param("bookingId", bookingId)
                .param("personId", personId).param("position", position)
                .update();
    }

    private String stateOf(UUID accountId) {
        return jdbc.sql("SELECT state FROM message_record WHERE account_id = :accountId AND kind = :kind")
                .param("accountId", accountId)
                .param("kind", MessageKind.BOOKING_RELEASED.name())
                .query(String.class)
                .single();
    }
}
