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
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.slf4j.LoggerFactory;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingConfirmationMessageTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private SeriesService series;

    private final ListAppender<ILoggingEvent> logged = new ListAppender<>();

    private UUID courtId;
    private UUID personId;
    private UUID accountId;

    @BeforeEach
    void aClubWithOneCourtAndOneMember() {
        doNothing().when(sender).send(any(MimeMessage.class));
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        accountId = identity.createEnabledAccount(personId, "doe.jane", Set.of(Role.MEMBER));
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
    void givenAMemberWhoBooksACourt_whenTheBookingIsWritten_thenTheConfirmationReachesThem()
            throws Exception {
        // when
        book(List.of(courtId));

        // then
        MimeMessage sent = theMessageHandedOver();
        assertThat(sent.getAllRecipients()[0].toString()).isEqualTo("jane.doe@example.org");
    }

    @Test
    void givenAConfirmation_whenItIsRead_thenItNamesThePeriodTheCourtAndTheCard() throws Exception {
        // when
        book(List.of(courtId));

        // then — a dialog nobody keeps is what this message replaces, so it carries the whole booking
        String body = body(theMessageHandedOver());
        assertThat(body).contains("13. Mai 2026", "18:00", "19:00", "Court 1", "Member booking");
    }

    @Test
    void givenABookingOnSeveralCourts_whenTheConfirmationIsRead_thenEveryCourtIsNamed()
            throws Exception {
        // given
        UUID second = facility.createCourt(2, "Court 2");

        // when
        book(List.of(courtId, second));

        // then
        assertThat(body(theMessageHandedOver())).contains("Court 1", "Court 2");
    }

    @Test
    void whenAConfirmationGoesOut_thenTheRecordNamesTheAccountTheKindAndTheMessage()
            throws Exception {
        // when
        book(List.of(courtId));
        MimeMessage sent = theMessageHandedOver();

        // then
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> assertThat(record())
                .containsEntry("account_id", accountId)
                .containsEntry("kind", "BOOKING_CONFIRMED")
                .containsEntry("state", "HANDED_OVER")
                .containsEntry("message_id", sent.getHeader("Message-ID")[0]));
    }

    @Test
    void givenAMemberWhoseAddressIsEmpty_whenTheyBookACourt_thenTheBookingStandsAndNothingIsSent() {
        // given
        UUID addressless = identity.createPerson("Mary", "Major", "");
        UUID account = identity.createEnabledAccount(addressless, "major.mary", Set.of(Role.MEMBER));

        // when
        bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), account, addressless, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("John Roe")), null));

        // then — a missing address is the club's to correct, never a reason to refuse the court
        verify(sender, never()).send(any(MimeMessage.class));
        assertThat(jdbc.sql("SELECT count(*) FROM booking").query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    void givenTheSameRequestTwice_whenTheSecondIsAnswered_thenOnlyOneConfirmationGoesOut() {
        // given — the key a client repeats after a connection it never saw answered
        book(List.of(courtId), "one-and-the-same-request");

        // when
        book(List.of(courtId), "one-and-the-same-request");

        // then — the replay answers with the booking that exists, so nothing is confirmed twice
        verify(sender, times(1)).send(any(MimeMessage.class));
    }

    @Test
    void givenASeriesOfOccurrences_whenItIsCreated_thenNoOccurrenceConfirmsItself() {
        // given
        UUID trainerPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID trainer = identity.createEnabledAccount(trainerPerson, "miles.richard", Set.of(Role.TRAINER));

        // when
        series.create(new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 5, 13),
                        LocalTime.of(18, 0), 60, 1, Set.of(DayOfWeek.WEDNESDAY), null, 3),
                List.of(SIX_PM, SIX_PM.plus(7, ChronoUnit.DAYS), SIX_PM.plus(14, ChronoUnit.DAYS)),
                trainer, trainerPerson, Set.of(Role.TRAINER), "Team training");

        // then — a series is one decision and gets one message of its own, not one per occurrence
        verify(sender, never()).send(any(MimeMessage.class));
    }

    @Test
    void whenAConfirmationGoesOut_thenNothingItLeavesBehindNamesTheMember() throws Exception {
        // when
        book(List.of(courtId));
        theMessageHandedOver();

        // then — the account id names a row, the name and the address name a person
        assertThat(logLines()).anyMatch(line -> line.contains(accountId.toString()));
        assertThat(logLines()).noneMatch(BookingConfirmationMessageTest::namesTheMember);
        assertThat(jdbc.sql("SELECT * FROM message_record").query().listOfRows())
                .isNotEmpty()
                .allSatisfy(row -> assertThat(row.values())
                        .filteredOn(value -> value != null)
                        .noneMatch(value -> namesTheMember(String.valueOf(value))));
        assertThat(jdbc.sql("SELECT payload FROM domain_event WHERE event_type = 'booking.booking.confirmed'")
                .query(String.class).list())
                .isNotEmpty()
                .noneMatch(BookingConfirmationMessageTest::namesTheMember);
    }

    private static boolean namesTheMember(String text) {
        return text.contains("jane.doe@example.org") || text.contains("Jane") || text.contains("Doe");
    }

    private List<String> logLines() {
        return logged.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    private void book(List<UUID> courtIds) {
        bookings.create(command(courtIds));
    }

    private void book(List<UUID> courtIds, String idempotencyKey) {
        bookings.create(command(courtIds), idempotencyKey);
    }

    private CreateBookingCommand command(List<UUID> courtIds) {
        return new CreateBookingCommand(courtIds, MEMBER_BOOKING_CARD,
                new TimeSlot(SIX_PM, SEVEN_PM), accountId, personId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("John Roe")), null);
    }

    private Map<String, Object> record() {
        return jdbc.sql("SELECT * FROM message_record WHERE kind = 'BOOKING_CONFIRMED'")
                .query().singleRow();
    }

    private MimeMessage theMessageHandedOver() {
        var captured = forClass(MimeMessage.class);
        verify(sender, timeout(10_000)).send(captured.capture());
        return captured.getValue();
    }

    private static String body(MimeMessage message) throws Exception {
        return message.getContent().toString();
    }
}
