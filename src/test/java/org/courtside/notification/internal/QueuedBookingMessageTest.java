package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
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

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class QueuedBookingMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;

    @BeforeEach
    void aClubWithAnEveningToBook() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenAConfirmationStillQueued_whenTheBookingIsCancelledBeforeItsTurn_thenItFailsAsCancelledUnsent() {
        // given
        UUID bookingId = book();
        bookings.cancel(bookingId, bookerAccountId, Set.of(Role.MEMBER));

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(outcome("BOOKING_CONFIRMED"))
                .as("a cancelled booking is not confirmed to anybody")
                .containsEntry("state", "FAILED").containsEntry("reason", "BookingCancelled");
    }

    @Test
    void givenAReminderStillQueued_whenTheBookingHasStartedByItsTurn_thenItFailsAsStartedUnsent() {
        // given
        UUID bookingId = book();
        outbox.deliverDue();
        clearInvocations(sender);
        jdbc.sql("""
                        INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at,
                                                    next_attempt_at, parameters)
                        VALUES (:id, :accountId, 'BOOKING_REMINDER', 'QUEUED', '<late@example.org>', :at, :at,
                                CAST(:parameters AS jsonb))
                        """)
                .param("id", UUID.randomUUID()).param("accountId", bookerAccountId)
                .param("at", java.sql.Timestamp.from(Instant.parse("2026-05-12T10:00:00Z")))
                .param("parameters", "{\"bookingId\": \"" + bookingId + "\"}")
                .update();
        jdbc.sql("UPDATE court_allocation SET starts_at = :startsAt WHERE booking_id = :id")
                .param("startsAt", java.sql.Timestamp.from(Instant.parse("2026-05-12T09:00:00Z")))
                .param("id", bookingId).update();

        // when
        outbox.deliverDue();

        // then
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(outcome("BOOKING_REMINDER"))
                .as("a reminder for a game already underway reminds nobody")
                .containsEntry("state", "FAILED").containsEntry("reason", "BookingStarted");
    }

    private UUID book() {
        return bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.guest("Richard Miles")), null));
    }

    private Map<String, Object> outcome(String kind) {
        return jdbc.sql("""
                        SELECT state, reason FROM message_record
                        WHERE account_id = :accountId AND kind = :kind
                        """)
                .param("accountId", bookerAccountId).param("kind", kind)
                .query().singleRow();
    }
}
