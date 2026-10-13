package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, NotificationTestFixture.class})
class SeriesSummaryMessageTest extends AbstractIntegrationTest {

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
    private UUID trainerAccountId;

    @BeforeEach
    void aTrainerWhoPlansAWeeklySession() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mail = new SentMail(sender);
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        trainerAccountId = identity.createEnabledAccount(
                identity.createPerson("Mary", "Major", "mary.major@example.org"), "major.mary",
                Set.of(Role.TRAINER));
    }

    @Test
    void givenThreeWeeklyOccurrences_whenTheSeriesIsCreated_thenTheHolderReceivesOneSummary() throws Exception {
        // when
        SeriesCreationResult created = createSeries(3);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .as("one entry for the series, not one per occurrence")
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
        assertThat(notifications.mailsQueuedFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
        assertThat(jdbc.sql("SELECT parameters::text FROM notification WHERE account_id = :accountId")
                .param("accountId", trainerAccountId).query(String.class).single())
                .as("the centre leads to the first occurrence and stores nothing else")
                .isEqualTo("{\"bookingId\": \"" + created.bookingIds().getFirst() + "\"}");
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Dienstag", "18:00", "20:00", "Court 1", "Training",
                        "Dienstag, 19. Mai 2026", "Dienstag, 2. Juni 2026", "Termine: 3");
    }

    @Test
    void givenStartsSentLatestFirst_whenTheSeriesIsCreated_thenTheCentreLeadsToTheEarliestOccurrence() {
        // given
        SeriesRule rule = new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 5, 19),
                LocalTime.of(18, 0), 120, 1, Set.of(DayOfWeek.TUESDAY), null, 3);
        List<Instant> starts = series.preview(rule, trainerAccountId, null, Set.of(Role.TRAINER))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList().reversed();

        // when
        series.create(rule, starts, trainerAccountId, null, Set.of(Role.TRAINER), null);

        // then
        UUID earliest = jdbc.sql("""
                        SELECT a.booking_id FROM court_allocation a JOIN booking b ON b.id = a.booking_id
                        WHERE b.series_id IS NOT NULL ORDER BY a.starts_at LIMIT 1
                        """).query(UUID.class).single();
        assertThat(jdbc.sql("SELECT parameters ->> 'bookingId' FROM notification WHERE account_id = :accountId")
                .param("accountId", trainerAccountId).query(String.class).single())
                .as("the entry leads to the first date of the series, whatever order the request named them in")
                .isEqualTo(earliest.toString());
    }

    @Test
    void givenAnEnglishSpeakingHolder_whenTheSeriesIsCreated_thenTheSummaryIsInEnglish() throws Exception {
        // given
        jdbc.sql("UPDATE user_account SET locale = 'en' WHERE id = :id").param("id", trainerAccountId).update();

        // when
        createSeries(2);

        // then
        assertThat(mail.bodiesTo("mary.major@example.org")).singleElement().asString()
                .contains("Tuesday", "18:00", "20:00", "Court 1", "Tuesday, May 19, 2026",
                        "Tuesday, May 26, 2026", "Occurrences: 2");
    }

    @Test
    void givenAHolderWhoDeclinedSeriesSummaries_whenTheSeriesIsCreated_thenTheyReceiveNothing() {
        // given
        notifications.decline(trainerAccountId, MessageKind.BOOKING_SERIES_CREATED);

        // when
        createSeries(3);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId)).isEmpty();
        assertThat(notifications.mailsQueuedFor(trainerAccountId)).isEmpty();
    }

    @Test
    void givenAHolderWhoSwitchedEmailOff_whenTheSeriesIsCreated_thenOnlyTheCentreHoldsTheSummary() {
        // given
        notifications.declineEmail(trainerAccountId);

        // when
        createSeries(3);

        // then
        assertThat(notifications.notificationsFor(trainerAccountId))
                .containsExactly(MessageKind.BOOKING_SERIES_CREATED);
        assertThat(notifications.mailsQueuedFor(trainerAccountId)).isEmpty();
    }

    private SeriesCreationResult createSeries(int count) {
        SeriesRule rule = new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 5, 19),
                LocalTime.of(18, 0), 120, 1, Set.of(DayOfWeek.TUESDAY), null, count);
        List<Instant> starts = series.preview(rule, trainerAccountId, null, Set.of(Role.TRAINER))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return series.create(rule, starts, trainerAccountId, null, Set.of(Role.TRAINER), null);
    }
}
