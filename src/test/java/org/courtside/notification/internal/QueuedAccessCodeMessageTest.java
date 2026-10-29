package org.courtside.notification.internal;

import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class})
class QueuedAccessCodeMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String CODE = "135790";

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    private UUID bookingId;
    private UUID janeAccount;
    private UUID john;
    private UUID johnAccount;

    @BeforeEach
    void aBookingBehindTheNorthGateThatJohnHasLeft() {
        doNothing().when(sender).send(any(MimeMessage.class));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Court 1");
        facility.createAccessPoint("North gate", List.of(court), CODE);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        bookingId = bookings.create(new CreateBookingCommand(List.of(court), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")),
                janeAccount, jane, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(john)), null));
        outbox.deliverDue();
        clearInvocations(sender);
    }

    @Test
    void givenAReminderQueuedForAPlayerWhoLeftBeforeItsTurn_whenItIsWritten_thenItCarriesNoCode() throws Exception {
        // given
        queue(johnAccount, "BOOKING_REMINDER");
        queue(janeAccount, "BOOKING_REMINDER");
        participations.withdraw(bookingId, john, johnAccount);

        // when
        outbox.deliverDue();

        // then
        assertThat(bodyTo("jane.doe@example.org")).as("the booker still needs the code").contains(CODE);
        assertThat(bodyTo("john.roe@example.org"))
                .as("a player who left the booking is not handed the code to its gate")
                .doesNotContain(CODE).doesNotContain("Zugangscode").doesNotContain("Access code");
    }

    @Test
    void givenACodeChangeQueuedForSomebodyNoLongerInTheBooking_whenItsTurnComes_thenItFailsUnsent() {
        // given
        participations.withdraw(bookingId, john, johnAccount);
        queue(johnAccount, "ACCESS_CODE_CHANGED");

        // when
        outbox.deliverDue();

        // then
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        assertThat(captured.getAllValues()).as("nothing reaches the player who left")
                .noneMatch(message -> recipientOf(message).equals("john.roe@example.org"));
        assertThat(jdbc.sql("SELECT state, reason FROM message_record WHERE account_id = :account AND kind = :kind")
                .param("account", johnAccount).param("kind", "ACCESS_CODE_CHANGED").query().singleRow())
                .as("a notice that exists to carry the code goes to nobody outside the booking")
                .containsEntry("state", "FAILED").containsEntry("reason", "NotInBooking");
    }

    private void queue(UUID accountId, String kind) {
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at, parameters)
                        VALUES (:id, :accountId, :kind, 'QUEUED', :messageId, :at, :at, CAST(:parameters AS jsonb))
                        """)
                .param("id", UUID.randomUUID()).param("accountId", accountId).param("kind", kind)
                .param("messageId", "<" + UUID.randomUUID() + "@example.org>")
                .param("at", Timestamp.from(Instant.parse("2026-05-12T10:00:00Z")))
                .param("parameters", "{\"bookingId\": \"" + bookingId + "\"}")
                .update();
    }

    private static String recipientOf(MimeMessage message) {
        try {
            return message.getAllRecipients()[0].toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String bodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeastOnce()).send(captured.capture());
        for (MimeMessage message : captured.getAllValues()) {
            if (address.equals(message.getAllRecipients()[0].toString())) {
                Object content = message.getContent();
                return content instanceof Multipart multipart
                        ? multipart.getBodyPart(0).getContent().toString() : content.toString();
            }
        }
        throw new AssertionError("Nothing reached " + address);
    }
}
