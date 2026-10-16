package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.internal.MinBookingDurationRule;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import({ConfigTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class})
class MinBookingDurationRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant WEDNESDAY_SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Map<String, Integer> AN_HOUR = Map.of("minDurationMinutes", 60);

    @Autowired
    private MinBookingDurationRule rule;

    @Autowired
    private RuleAdminService ruleAdmin;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private UUID courtId;
    private UUID personId;

    @BeforeEach
    void setUp() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facilityFixture.createCourt(1, "Court 1");
        personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        members.assignMembership(personId, ACTIVE);
    }

    @Test
    void givenAMinimumOfAnHour_whenAMemberBooksHalfAnHour_thenTheBookingIsRefusedNamingTheMinimum() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.MIN_BOOKING_DURATION, AN_HOUR);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> book(30, Role.MEMBER));

        // then
        assertThat(refusal).as("30 minutes are short of a 60-minute minimum").isNotNull();
        assertThat(refusal.getViolations()).anySatisfy(violation -> {
            assertThat(violation.code()).isEqualTo("booking.rule.minBookingDuration.notReached");
            assertThat(violation.params()).isEqualTo(Map.of("minMinutes", 60));
        });
    }

    @Test
    void givenAMinimumOfAnHour_whenAMemberBooksExactlyAnHour_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.MIN_BOOKING_DURATION, AN_HOUR);

        // when
        UUID bookingId = book(60, Role.MEMBER);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenAMinimumOfAnHour_whenAnAdministratorBooksHalfAnHour_thenTheMinimumIsOverridden() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.MIN_BOOKING_DURATION, AN_HOUR);

        // when
        UUID bookingId = book(30, Role.ADMIN);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenTheMinimumBelongsToAnotherRuleSet_whenChecking_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.MIN_BOOKING_DURATION, AN_HOUR);

        // when
        List<RuleViolation> violations = rule.check(context(YOUTH, 30));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenNoMinimum_whenChecking_thenNothingIsReported() {
        // when
        List<RuleViolation> violations = rule.check(context(ACTIVE, 30));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void whenAskingTheRuleWhetherItJudgesAMove_thenItDoes() {
        // when / then
        assertThat(rule.appliesToAMove()).as("a move that shortens a booking must meet the minimum").isTrue();
        assertThat(rule.isOverridable()).isTrue();
    }

    private UUID book(int minutes, Role role) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(WEDNESDAY_SIX_PM, WEDNESDAY_SIX_PM.plusSeconds(minutes * 60L)), UUID.randomUUID(),
                personId, Set.of(role), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private RuleContext context(UUID membershipTypeId, int minutes) {
        return new RuleContext(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(WEDNESDAY_SIX_PM, WEDNESDAY_SIX_PM.plusSeconds(minutes * 60L)),
                UUID.randomUUID(), membershipTypeId);
    }
}
