package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, RulesTestFixture.class})
class SeriesRuleRejectionCountTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String OUTSIDE_HOURS = "booking.rule.bookingHours.outside";

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID ownerPersonId;
    private UUID owner;

    @BeforeEach
    void setUp() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        ownerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        owner = identity.createAccount(ownerPersonId, "doe.jane", Set.of(Role.TRAINER));
        UUID juniors = members.membershipTypeMeasuredBy("Juniors",
                rules.ruleSetLimitingBookingHours("Junior hours", LocalTime.of(9, 0), LocalTime.of(20, 0)));
        members.assignMembership(ownerPersonId, juniors);
    }

    @Test
    void givenASeriesOutsideTheBookingHours_whenItIsCreated_thenEachRefusedOccurrenceIsCounted() {
        // when
        SeriesCreationResult result = create(LocalTime.of(19, 30));

        // then
        assertThat(result.skipped()).hasSize(2);
        assertThat(rejections()).as("each refused occurrence is one counted attempt")
                .hasSize(2).containsOnly(OUTSIDE_HOURS);
    }

    @Test
    void givenASeriesInsideTheHours_whenItIsMovedPastThem_thenTheRefusedMoveIsCounted() {
        // given
        SeriesCreationResult series = create(LocalTime.of(18, 0));

        // when
        assertThatThrownBy(() -> seriesService.move(moveTo(series, LocalTime.of(19, 30)), owner, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingRulesViolatedException.class);

        // then
        assertThat(rejections()).as("the refused move is counted").containsExactly(OUTSIDE_HOURS);
    }

    @Test
    void givenTheRejectionRecordRefusesEveryRow_whenAMoveIsRefused_thenTheOwnerStillReceivesTheRefusal() {
        // given
        SeriesCreationResult series = create(LocalTime.of(18, 0));
        jdbc.sql("ALTER TABLE booking_rule_rejection ADD CONSTRAINT refuse_every_row CHECK (false)").update();
        try {
            // when / then
            assertThatThrownBy(() -> seriesService.move(moveTo(series, LocalTime.of(19, 30)), owner,
                    Set.of(Role.TRAINER)))
                    .as("a count that cannot be written must not replace the refusal")
                    .isInstanceOf(BookingRulesViolatedException.class);
        } finally {
            jdbc.sql("ALTER TABLE booking_rule_rejection DROP CONSTRAINT refuse_every_row").update();
        }
    }

    @Test
    void givenTheRejectionRecordRefusesEveryRow_whenASeriesIsCreatedOutsideTheHours_thenItsOccurrencesAreStillSkipped() {
        // given
        jdbc.sql("ALTER TABLE booking_rule_rejection ADD CONSTRAINT refuse_every_row CHECK (false)").update();
        try {
            // when
            SeriesCreationResult result = create(LocalTime.of(19, 30));

            // then
            assertThat(result.skipped()).as("a count that cannot be written must not fail the series").hasSize(2);
        } finally {
            jdbc.sql("ALTER TABLE booking_rule_rejection DROP CONSTRAINT refuse_every_row").update();
        }
    }

    private List<String> rejections() {
        return jdbc.sql("SELECT rule_code FROM booking_rule_rejection")
                .query(String.class).list();
    }

    private MoveRequest moveTo(SeriesCreationResult series, LocalTime start) {
        return new MoveRequest(series.seriesId(), series.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, start, null, null);
    }

    private SeriesCreationResult create(LocalTime start) {
        SeriesRule rule = new SeriesRule(List.of(court), TRAINING_CARD, LocalDate.of(2026, 4, 7), start, 60,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        List<Instant> starts = seriesService.preview(rule, owner, ownerPersonId, Set.of(Role.TRAINER))
                .occurrences().stream().map(occurrence -> occurrence.slot().start()).toList();
        return seriesService.create(rule, starts, owner, ownerPersonId, Set.of(Role.TRAINER), null);
    }
}
