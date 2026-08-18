package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.member.MemberRepository;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class SeriesQueryBudgetTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID STANDARD_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private SqlStatementCounter queries;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private MemberRepository members;

    private UUID courtId;
    private UUID trainer;
    private UUID trainerPersonId;

    @BeforeEach
    void setUp() {
        courtId = courts.save(new Court(1, "Court 1")).getId();
        trainerPersonId = persons.save(new Person("John", "Roe", "john@example.org")).getId();
        members.save(memberSince(trainerPersonId, STANDARD_MEMBERSHIP));
        trainer = UUID.randomUUID();
        Arrays.stream(DayOfWeek.values())
                .forEach(day -> openingHours.save(new OpeningHours(
                        day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)))));
    }

    @AfterEach
    void stopCountingQueries() {
        queries.pause();
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 20, 200})
    void givenASeriesSize_whenMeasuringCreatePreview_thenStableRuleQueriesStayBounded(int count) {
        // given
        SeriesRule rule = dailyRule(count);
        queries.reset();

        // when
        SeriesPreview preview = seriesService.preview(
                rule, trainer, trainerPersonId, Set.of(Role.TRAINER));
        SqlStatementCounter.Snapshot snapshot = queries.snapshot();

        // then
        assertThat(preview.occurrences()).hasSize(count);
        assertStableRuleQueriesAreBounded(snapshot);
        assertThat(snapshot.total()).as(snapshot.toString()).isLessThanOrEqualTo(count + 14L);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 20, 200})
    void givenASeriesSize_whenMeasuringMovePreviewAndMove_thenStableRuleQueriesStayBounded(int count) {
        // given
        SeriesCreationResult series = createSeries(count);
        MoveRequest request = new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(19, 0), null, null);
        queries.reset();

        // when
        MovePreview preview = seriesService.previewMove(request, trainer, Set.of(Role.ADMIN));
        SqlStatementCounter.Snapshot previewSnapshot = queries.snapshot();
        queries.reset();
        int moved = seriesService.move(request, trainer, Set.of(Role.ADMIN));
        SqlStatementCounter.Snapshot moveSnapshot = queries.snapshot();

        // then
        assertThat(preview.moves()).hasSize(count);
        assertThat(moved).isEqualTo(count);
        assertStableRuleQueriesAreBounded(previewSnapshot);
        assertStableRuleQueriesAreBounded(moveSnapshot, 14);
        assertThat(previewSnapshot.total()).as(previewSnapshot.toString())
                .isLessThanOrEqualTo(3L * count + 13);
        assertThat(moveSnapshot.total()).as(moveSnapshot.toString())
                .isLessThanOrEqualTo(8L * count + 30);
    }

    private SeriesCreationResult createSeries(int count) {
        SeriesRule rule = dailyRule(count);
        List<java.time.Instant> starts = seriesService.preview(
                        rule, trainer, null, Set.of(Role.ADMIN)).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(
                rule, starts, trainer, null, Set.of(Role.ADMIN), "Training");
    }

    private SeriesRule dailyRule(int count) {
        return new SeriesRule(
                List.of(courtId), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 60,
                1, Set.of(DayOfWeek.values()), null, count);
    }

    private void assertStableRuleQueriesAreBounded(SqlStatementCounter.Snapshot snapshot) {
        assertStableRuleQueriesAreBounded(snapshot, 7);
    }

    private void assertStableRuleQueriesAreBounded(SqlStatementCounter.Snapshot snapshot,
                                                   long openingHoursBudget) {
        assertThat(snapshot.category("membership")).as(snapshot.toString()).isLessThanOrEqualTo(1);
        assertThat(snapshot.category("opening-hours")).as(snapshot.toString())
                .isLessThanOrEqualTo(openingHoursBudget);
        assertThat(snapshot.category("rule-parameter")).as(snapshot.toString()).isLessThanOrEqualTo(2);
    }
}
