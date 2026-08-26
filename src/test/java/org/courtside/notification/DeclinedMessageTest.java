package org.courtside.notification;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class})
class DeclinedMessageTest extends AbstractIntegrationTest {

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
    private NotificationTestFixture messages;

    @Autowired
    private JdbcClient jdbc;

    private final ListAppender<ILoggingEvent> logged = new ListAppender<>();

    private UUID courtId;
    private UUID bookerPersonId;
    private UUID bookerAccountId;
    private UUID playerPersonId;

    @BeforeEach
    void aMemberWhoCanBook() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        logged.start();
        ownLogger().addAppender(logged);
    }

    @AfterEach
    void stopListening() {
        ownLogger().detachAppender(logged);
    }

    private static Logger ownLogger() {
        Logger logger = (Logger) LoggerFactory.getLogger("org.courtside");
        logger.setLevel(Level.DEBUG);
        return logger;
    }

    @Test
    void givenAMemberWhoDeclinedConfirmations_whenTheyBook_thenNothingIsSentAndNothingIsLogged() {
        // given
        messages.decline(bookerAccountId, MessageKind.BOOKING_CONFIRMED);
        clearInvocations(sender);

        // when
        book();

        // then — a message nobody wanted is not a message that failed, so the log stays empty too
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(kindsRecorded()).isEmpty();
        assertThat(logLines()).noneMatch(line -> line.startsWith("Handed over"));
    }

    @Test
    void givenAMemberWhoDeclinedNothing_whenTheyBook_thenTheConfirmationGoesOut() {
        // given — the absence of a choice is a yes, so nothing has to be written to be reached
        clearInvocations(sender);

        // when
        book();

        // then
        verify(sender).send(any(MimeMessage.class));
        assertThat(kindsRecorded()).containsExactly("BOOKING_CONFIRMED");
        assertThat(logLines()).anyMatch(line ->
                line.equals("Handed over a BOOKING_CONFIRMED message for account " + bookerAccountId));
    }

    @Test
    void givenAMemberWhoDeclinedOneKind_whenAnotherKindIsSent_thenItStillReachesThem() {
        // given
        messages.decline(bookerAccountId, MessageKind.BOOKING_REMINDER);
        clearInvocations(sender);

        // when
        book();

        // then
        verify(sender).send(any(MimeMessage.class));
        assertThat(kindsRecorded()).containsExactly("BOOKING_CONFIRMED");
    }

    private void book() {
        bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), bookerAccountId, bookerPersonId, Set.of(Role.MEMBER),
                null, List.of(ParticipantSpec.member(playerPersonId)), null));
    }

    private List<String> logLines() {
        return logged.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private List<String> kindsRecorded() {
        return jdbc.sql("SELECT kind FROM message_record").query(String.class).list();
    }
}
