package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.SqlStatementCounter;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
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
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private UUID courtId;
    private UUID trainer;
    private UUID trainerPersonId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        trainerPersonId = identity.createPerson("John", "Roe", "john@example.org");
        members.assignMembership(trainerPersonId, STANDARD_MEMBERSHIP);
        trainer = UUID.randomUUID();
        Arrays.stream(DayOfWeek.values())
                .forEach(day -> facilityFixture.setOpeningHours(
                        day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
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
        assertThat(snapshot.total()).as(snapshot.toString()).isLessThanOrEqualTo(count + 15L);
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
        // One per membership-scoped rule and no more: the advance window, the open-booking cap and
        // the booking bar each ask once for the whole batch, which is what prepare() is for.
        assertThat(snapshot.category("rule-parameter")).as(snapshot.toString()).isLessThanOrEqualTo(3);
    }
}
