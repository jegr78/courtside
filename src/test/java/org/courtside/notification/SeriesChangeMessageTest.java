package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
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
class SeriesChangeMessageTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @MockitoSpyBean
    private JavaMailSender sender;

    private SentMail mail;

    @Autowired
    private SeriesService series;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private NotificationTestFixture notifications;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private UUID secondCourtId;
    private UUID trainerAccountId;
    private UUID boardAccountId;
    private SeriesCreationResult created;

    @BeforeEach
    void aTrainersWeeklySessionAndABoard() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        courtId = facility.createCourt(1, "Court 1");
        secondCourtId = facility.createCourt(2, "Court 2");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        trainerAccountId = identity.createEnabledAccount(
                identity.createPerson("Mary", "Major", "mary.major@example.org"), "major.mary",
                Set.of(Role.TRAINER));
        boardAccountId = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles", "richard.miles@example.org"), "miles.richard",
                Set.of(Role.ADMIN));
        SeriesRule rule = new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 5, 19),
                LocalTime.of(18, 0), 120, 1, Set.of(DayOfWeek.TUESDAY), null, 3);
        List<Instant> starts = series.preview(rule, trainerAccountId, null, Set.of(Role.TRAINER))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        created = series.create(rule, starts, trainerAccountId, null, Set.of(Role.TRAINER), null);
        clearInvocations(sender);
    }

    @Test
    void givenAReason_whenTheBoardCancelsTheRestOfASeries_thenTheHolderGetsOneMessageNamingDatesAndReason()
            throws Exception {
        // when
        series.cancel(created.seriesId(), created.bookingIds().get(1), CancelScope.THIS_AND_FOLLOWING,
                boardAccountId, Set.of(Role.ADMIN), CancellationReason.WEATHER);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .as("one message for the series, none per occurrence")
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB);
        assertThat(notifications.mailsQueuedFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB);
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Dienstag, 18:00 bis 20:00", "Court 1", "Training",
                        "Erster stornierter Termin: Dienstag, 26. Mai 2026",
                        "Letzter stornierter Termin: Dienstag, 2. Juni 2026", "Stornierte Termine: 2",
                        "Grund: das Wetter.")
                .doesNotContain("Richard").doesNotContain("Miles");
        assertThat(jdbc.sql("""
                        SELECT parameters::text FROM notification
                        WHERE kind = 'BOOKING_SERIES_CANCELLED_BY_CLUB'
                        """).query(String.class).single())
                .as("the centre keeps the first cancelled date and the code, not the list")
                .isEqualTo("{\"reason\": \"WEATHER\", \"bookingId\": \"" + created.bookingIds().get(1) + "\"}");
        assertThat(jdbc.sql("SELECT count(*) FROM booking WHERE cancellation_reason = 'WEATHER'")
                .query(Long.class).single())
                .isEqualTo(2L);
    }

    @Test
    void givenAPlayedDate_whenTheBoardCancelsTheWholeSeries_thenTheMessageNamesOnlyTheDatesAhead() throws Exception {
        // given
        jdbc.sql("""
                        UPDATE court_allocation SET starts_at = TIMESTAMPTZ '2026-05-05T16:00:00Z',
                                                    ends_at = TIMESTAMPTZ '2026-05-05T18:00:00Z'
                        WHERE booking_id = :booking
                        """)
                .param("booking", created.bookingIds().getFirst()).update();

        // when
        series.cancel(created.seriesId(), created.bookingIds().get(1), CancelScope.WHOLE_SERIES,
                boardAccountId, Set.of(Role.ADMIN), CancellationReason.WEATHER);

        // then
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .as("a played date is neither cancelled nor counted")
                .contains("Erster stornierter Termin: Dienstag, 26. Mai 2026", "Stornierte Termine: 2")
                .doesNotContain("5. Mai 2026");
    }

    @Test
    void givenNoReason_whenTheBoardCancelsAnEnglishHoldersSeries_thenTheMessageSendsThemToTheClub()
            throws Exception {
        // given
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", trainerAccountId).update();

        // when
        series.cancel(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                boardAccountId, Set.of(Role.ADMIN), null);

        // then
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Tuesday, 18:00 to 20:00", "First cancelled date: Tuesday, May 19, 2026",
                        "Last cancelled date: Tuesday, June 2, 2026", "Cancelled dates: 3",
                        "Contact your club if you want to know why.");
    }

    @Test
    void whenTheHolderCancelsTheirOwnSeries_thenNobodyIsWrittenTo() {
        // when
        series.cancel(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                trainerAccountId, Set.of(Role.TRAINER), null);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
    }

    @Test
    void givenAReason_whenTheHolderCancelsTheirOwnSeries_thenNothingIsCancelled() {
        // when / then
        assertThatThrownBy(() -> series.cancel(created.seriesId(), created.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainerAccountId, Set.of(Role.TRAINER), CancellationReason.OTHER))
                .isInstanceOfSatisfying(CodedDomainFailure.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("booking.cancellationReason.ownBooking"));
        assertThat(jdbc.sql("SELECT count(*) FROM booking WHERE status = 'CONFIRMED'").query(Long.class).single())
                .isEqualTo(3L);
    }

    @Test
    void whenTheBoardMovesTheRestOfASeries_thenTheHolderGetsOneMessageWithTheOldAndTheNewTime() throws Exception {
        // when
        series.move(new MoveRequest(created.seriesId(), created.bookingIds().get(1), CancelScope.THIS_AND_FOLLOWING,
                LocalTime.of(19, 0), null, null), boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_MOVED_BY_CLUB);
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Bisher: 18:00 bis 20:00, Platz: Court 1", "Jetzt: Dienstag, 19:00 bis 21:00, Platz: Court 1",
                        "Erster verlegter Termin: Dienstag, 26. Mai 2026", "Verlegte Termine: 2");
    }

    @Test
    void whenTheBoardMovesOnlyTheCourts_thenTheMessageNamesTheOldAndTheNewCourt() throws Exception {
        // when
        series.move(new MoveRequest(created.seriesId(), created.bookingIds().get(1), CancelScope.THIS_AND_FOLLOWING,
                null, null, List.of(secondCourtId)), boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Bisher: 18:00 bis 20:00, Platz: Court 1", "Jetzt: Dienstag, 18:00 bis 20:00, Platz: Court 2");
    }

    @Test
    void givenAnEnglishHolder_whenTheBoardMovesTimeAndCourt_thenTheMessageNamesBothChanges() throws Exception {
        // given
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", trainerAccountId).update();

        // when
        series.move(new MoveRequest(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 0), null, List.of(secondCourtId)), boardAccountId, Set.of(Role.ADMIN));

        // then
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Before: 18:00 to 20:00, court: Court 1", "Now: Tuesday, 19:00 to 21:00, court: Court 2",
                        "Moved dates: 3");
    }

    @Test
    void givenAReason_whenTheHolderCancelsDatesTheBoardAlreadyCancelled_thenTheReasonIsStillRefused() {
        // given
        series.cancel(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                boardAccountId, Set.of(Role.ADMIN), null);

        // when / then
        assertThatThrownBy(() -> series.cancel(created.seriesId(), created.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainerAccountId, Set.of(Role.TRAINER), CancellationReason.WEATHER))
                .isInstanceOfSatisfying(CodedDomainFailure.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("booking.cancellationReason.ownBooking"));
    }

    @Test
    void whenTheHolderMovesTheirOwnSeries_thenNobodyIsWrittenTo() {
        // when
        series.move(new MoveRequest(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 0), null, null), trainerAccountId, Set.of(Role.TRAINER));

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
    }

    @Test
    void givenAHolderWhoSwitchedEmailOff_whenTheBoardCancelsTheirSeries_thenOnlyTheCentreTellsThem() {
        // given
        notifications.declineEmail(trainerAccountId);

        // when
        series.cancel(created.seriesId(), created.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                boardAccountId, Set.of(Role.ADMIN), null);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB);
        assertThat(notifications.mailsQueuedFor(trainerAccountId))
                .as("the channel choice stops the mail of a kind that cannot be declined")
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
    }
}
