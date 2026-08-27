package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class,
        RulesTestFixture.class})
class SeriesMoveDurationBoundTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

    private UUID courtOne;
    private UUID ownerPersonId;
    private UUID owner;

    @BeforeEach
    void setUp() {
        courtOne = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        ownerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        owner = identity.createAccount(ownerPersonId, "doe.jane", Set.of(Role.TRAINER));
        members.assignMembership(ownerPersonId, members.membershipTypeMeasuredBy(
                "Short-slot members", rules.ruleSetBoundingBookingDuration("Short slots", 90)));
    }

    @Test
    void givenABoundTheSeriesKeeps_whenTheOwnerStretchesItPastTheBound_thenTheMoveIsRefused() {
        // given
        SeriesCreationResult series = createSeries(60);

        // when — a bound the owner can walk around by stretching what they already hold is no bound
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> seriesService.move(stretchTo(series, 120), owner, Set.of(Role.TRAINER)));

        // then
        assertThat(refusal.getViolations())
                .anySatisfy(violation -> {
                    assertThat(violation.code()).isEqualTo("booking.rule.maxBookingDuration.exceeded");
                    assertThat(violation.params()).containsEntry("maxMinutes", 90);
                });
    }

    @Test
    void givenABoundTheSeriesKeeps_whenTheOwnerStretchesItToTheBound_thenItMoves() {
        // given
        SeriesCreationResult series = createSeries(60);

        // when
        int moved = seriesService.move(stretchTo(series, 90), owner, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
    }

    @Test
    void givenABoundTheSeriesKeeps_whenAnAdministratorStretchesItPastTheBound_thenItMoves() {
        // given
        SeriesCreationResult series = createSeries(60);

        // when — the role itself is the override, on a move as on a booking
        int moved = seriesService.move(stretchTo(series, 240), UUID.randomUUID(), Set.of(Role.ADMIN));

        // then
        assertThat(moved).isEqualTo(2);
    }

    private MoveRequest stretchTo(SeriesCreationResult series, int minutes) {
        return new MoveRequest(series.seriesId(), series.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, null, minutes, null);
    }

    private SeriesCreationResult createSeries(int minutes) {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), minutes,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        List<Instant> starts = seriesService
                .preview(rule, owner, ownerPersonId, Set.of(Role.TRAINER)).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, owner, ownerPersonId,
                Set.of(Role.TRAINER), "Training");
    }
}
