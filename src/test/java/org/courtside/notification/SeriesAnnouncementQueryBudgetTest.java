package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class SeriesAnnouncementQueryBudgetTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService series;

    @Autowired
    private BookingAnnouncer announcer;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private SqlStatementCounter queries;

    private UUID courtId;
    private UUID trainerAccountId;

    @BeforeEach
    void aCourtAndATrainer() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        trainerAccountId = identity.createEnabledAccount(
                identity.createPerson("Mary", "Major", "mary.major@example.org"), "major.mary",
                Set.of(Role.TRAINER));
    }

    @Test
    void givenSeriesOfDifferentLength_whenTheyAreDescribed_thenTheStatementsDoNotGrowWithTheOccurrences() {
        // given
        SeriesCreationResult twoDates = createSeries(DayOfWeek.TUESDAY, 2);
        SeriesCreationResult eightDates = createSeries(DayOfWeek.THURSDAY, 8);

        // when
        long shortSeries = statementsFor(() -> announcer.describeSeries(twoDates.seriesId()));
        long longSeries = statementsFor(() -> announcer.describeSeries(eightDates.seriesId()));
        long fewDates = statementsFor(() -> announcer.describeAll(twoDates.bookingIds()));
        long manyDates = statementsFor(() -> announcer.describeAll(eightDates.bookingIds()));

        // then
        assertThat(longSeries).as("a series of eight costs what a series of two costs").isEqualTo(shortSeries);
        assertThat(manyDates).as("eight affected dates cost what two cost").isEqualTo(fewDates);
    }

    private long statementsFor(Runnable read) {
        queries.reset();
        read.run();
        long total = queries.snapshot().total();
        queries.pause();
        return total;
    }

    private SeriesCreationResult createSeries(DayOfWeek weekday, int count) {
        SeriesRule rule = new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 5, 18),
                LocalTime.of(18, 0), 60, 1, Set.of(weekday), null, count);
        List<Instant> starts = series.preview(rule, trainerAccountId, null, Set.of(Role.TRAINER))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return series.create(rule, starts, trainerAccountId, null, Set.of(Role.TRAINER), null);
    }
}
