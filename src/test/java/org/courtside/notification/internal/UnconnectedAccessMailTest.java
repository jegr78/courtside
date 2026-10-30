package org.courtside.notification.internal;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
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
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, CardTestFixture.class, BookingTestFixture.class})
class UnconnectedAccessMailTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    @Test
    void givenNoConnector_whenABookingBehindAGateWithoutAStaticCodeIsConfirmed_thenTheMailIsSentAsBefore()
            throws Exception {
        // given
        doNothing().when(sender).send(any(MimeMessage.class));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Court 1");
        facility.createAccessPointWithEmergencyCode("North gate", List.of(court), "975310");
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");

        // when
        bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")),
                janeAccount, jane, Set.of(Role.MEMBER), null, john);
        outbox.deliverDue();

        // then
        assertThat(jdbc.sql("SELECT state FROM message_record WHERE kind = 'BOOKING_CONFIRMED'")
                .query(String.class).single()).as("without a connector nothing waits").isEqualTo("HANDED_OVER");
        var captured = forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        String body = MailBodies.textOf(captured.getValue().getContent());
        assertThat(body).as("a club without an access-control system gets the confirmation it always got")
                .contains("Buchungsart: Mitgliederbuchung\n\nDu kannst die Buchung")
                .doesNotContain("Zugangscode").doesNotContain("975310");
    }
}
