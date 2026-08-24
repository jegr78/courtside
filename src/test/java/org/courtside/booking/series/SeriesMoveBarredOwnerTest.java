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
class SeriesMoveBarredOwnerTest extends AbstractIntegrationTest {

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
    }

    @Test
    void givenTheOwnerIsBarredAfterCreatingASeries_whenTheyMoveIt_thenTheMoveIsRefused() {
        // given
        SeriesCreationResult series = createSeries();
        members.assignMembership(ownerPersonId, barredMembershipType());

        // when — a bar the owner can walk around by reshaping what they already hold is not a bar
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> seriesService.move(moveTo(series, LocalTime.of(20, 0)), owner,
                        Set.of(Role.TRAINER)));

        // then
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.noCourtBooking");
    }

    @Test
    void givenTheOwnerIsBarred_whenAnAdministratorMovesTheSeries_thenItStillMoves() {
        // given
        SeriesCreationResult series = createSeries();
        members.assignMembership(ownerPersonId, barredMembershipType());

        // when — the role itself is the override, on a move as on a booking
        int moved = seriesService.move(moveTo(series, LocalTime.of(20, 0)), UUID.randomUUID(),
                Set.of(Role.ADMIN));

        // then
        assertThat(moved).isEqualTo(2);
    }

    @Test
    void givenTheOwnerIsNotBarred_whenTheyMoveTheSeries_thenItMoves() {
        // given
        SeriesCreationResult series = createSeries();

        // when
        int moved = seriesService.move(moveTo(series, LocalTime.of(20, 0)), owner,
                Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
    }

    private UUID barredMembershipType() {
        return members.membershipTypeMeasuredBy(
                "Passive members", rules.ruleSetBarringCourtBookings("Passive"));
    }

    private MoveRequest moveTo(SeriesCreationResult series, LocalTime start) {
        return new MoveRequest(series.seriesId(), series.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, start, null, null);
    }

    private SeriesCreationResult createSeries() {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        List<Instant> starts = seriesService
                .preview(rule, owner, ownerPersonId, Set.of(Role.TRAINER)).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, owner, ownerPersonId,
                Set.of(Role.TRAINER), "Training");
    }
}
