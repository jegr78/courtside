package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.card.testfixture.CardTestFixture;
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
        RulesTestFixture.class, CardTestFixture.class})
class SeriesWeeklyBookedHoursTest extends AbstractIntegrationTest {

    private static final Set<Role> TRAINER = Set.of(Role.TRAINER);

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

    @Autowired
    private CardTestFixture cards;

    private UUID court;
    private UUID countingCard;
    private UUID ownerPersonId;
    private UUID owner;

    @BeforeEach
    void setUp() {
        court = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        countingCard = cards.createCardCountingAgainstLimits("Coaching", TRAINER);
        ownerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        owner = identity.createAccount(ownerPersonId, "doe.jane", TRAINER);
        members.assignMembership(ownerPersonId, members.membershipTypeMeasuredBy("Coaches",
                rules.ruleSetLimitingWeeklyHours("Two hours a week", 2)));
    }

    @Test
    void givenTwoWeekdaysOfAnHourEach_whenPreviewingTheSeries_thenTheWeekFillsAndTheThirdHourIsRefused() {
        // when
        SeriesPreview preview = seriesService.preview(
                rule(Set.of(DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY), 60, 3),
                owner, ownerPersonId, TRAINER);

        // then
        assertThat(preview.occurrences()).extracting(occurrence -> occurrence.violations().stream()
                        .map(RuleViolation::code).toList())
                .as("three hours in one week pass a two-hour limit at the third occurrence")
                .containsExactly(List.of(), List.of(), List.of("booking.rule.weeklyBookedHours.exceeded"));
    }

    @Test
    void givenASeriesOfAnHourAWeek_whenTheOwnerLengthensItPastTheWeeklyLimit_thenTheMoveIsRefused() {
        // given
        SeriesCreationResult series = createSeries(rule(Set.of(DayOfWeek.TUESDAY), 60, 2));

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> seriesService.move(new MoveRequest(series.seriesId(), series.bookingIds().getFirst(),
                        CancelScope.WHOLE_SERIES, LocalTime.of(10, 0), 180, null), owner, TRAINER));

        // then
        assertThat(refusal).as("a move that lengthens an hour to three passes a two-hour week").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.weeklyBookedHours.exceeded");
    }

    @Test
    void givenASeriesFillingTheWeek_whenTheOwnerMovesItToAnotherTime_thenItsOwnHoursDoNotCountAgainstIt() {
        // given
        SeriesCreationResult series = createSeries(rule(Set.of(DayOfWeek.TUESDAY), 120, 2));

        // when
        int moved = seriesService.move(new MoveRequest(series.seriesId(), series.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, LocalTime.of(14, 0), null, null), owner, TRAINER);

        // then
        assertThat(moved).as("the moved bookings leave their old place in the week").isEqualTo(2);
    }

    private SeriesRule rule(Set<DayOfWeek> weekdays, int minutes, int occurrences) {
        return new SeriesRule(List.of(court), countingCard, LocalDate.of(2026, 4, 7), LocalTime.of(10, 0),
                minutes, 1, weekdays, null, occurrences);
    }

    private SeriesCreationResult createSeries(SeriesRule rule) {
        List<Instant> starts = seriesService.preview(rule, owner, ownerPersonId, TRAINER).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, owner, ownerPersonId, TRAINER, "Coaching");
    }
}
