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
import org.courtside.rules.internal.MaxBookingDurationRule;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import({ConfigTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class})
class MaxBookingDurationRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID YOUTH_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private MaxBookingDurationRule rule;

    @Autowired
    private RuleAdminService ruleAdmin;

    @Autowired
    private ConfigTestFixture clubConfiguration;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private UUID courtId;
    private UUID bookerPersonId;
    private final UUID booker = UUID.randomUUID();

    @BeforeEach
    void openTheFacilityForAYouthMember() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        members.assignMembership(bookerPersonId, YOUTH);
    }

    @Test
    void givenARuleSetBoundingDuration_whenALongerBookingChecks_thenTheBoundIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, 120));

        // then
        assertThat(violations).singleElement()
                .satisfies(violation -> {
                    assertThat(violation.code()).isEqualTo("booking.rule.maxBookingDuration.exceeded");
                    assertThat(violation.params()).containsEntry("maxMinutes", 90);
                });
    }

    @Test
    void givenARuleSetBoundingDuration_whenABookingIsExactlyTheBound_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when — the bound is what a club allows, not what it stops one minute short of
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, 90));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenARuleSetBoundingDuration_whenAnotherMembershipTypeChecks_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when
        List<RuleViolation> violations = rule.check(contextFor(ACTIVE, 240));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenNoRuleSetBoundsDuration_whenChecking_thenNothingIsReported() {
        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, 600));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTheClubRuleSetBoundsDuration_whenSomebodyHoldsNoMembershipType_thenItStillApplies() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);

        // when — holding no membership type is where a bound is easiest to lose
        List<RuleViolation> violations = rule.check(contextFor(null, 120));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.maxBookingDuration.exceeded");
    }

    @Test
    void givenARuleSetBoundingDuration_whenAHolderBooksLonger_thenTheBookingIsRefusedWithThatCode() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class, () -> book(Role.MEMBER, 120));

        // then
        assertThat(refusal.getViolations())
                .anySatisfy(violation -> {
                    assertThat(violation.code()).isEqualTo("booking.rule.maxBookingDuration.exceeded");
                    assertThat(violation.params()).containsEntry("maxMinutes", 90);
                });
    }

    @Test
    void givenARuleSetBoundingDuration_whenAHolderBooksTheBound_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when
        UUID bookingId = book(Role.MEMBER, 90);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenARuleSetBoundingDuration_whenAnAdministratorBooksLonger_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.MAX_BOOKING_DURATION, Map.of("maxMinutes", 90));

        // when — a bound states how long a member may hold a court, and the role is the override
        UUID bookingId = book(Role.ADMIN, 240);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void whenAskingTheRuleWhetherItJudgesAMove_thenItDoes() {
        // when / then — a move may lengthen a booking, so a bound that skips it is no bound
        assertThat(rule.appliesToAMove()).isTrue();
    }

    private UUID book(Role role, int minutes) {
        Instant from = Instant.parse("2026-05-13T16:00:00Z");
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, from.plus(minutes, ChronoUnit.MINUTES)), booker, bookerPersonId,
                Set.of(role), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private RuleContext contextFor(UUID membershipTypeId, int minutes) {
        Instant start = Instant.parse("2026-05-13T09:00:00Z");
        return new RuleContext(UUID.randomUUID(), UUID.randomUUID(),
                new TimeSlot(start, start.plus(minutes, ChronoUnit.MINUTES)),
                UUID.randomUUID(), membershipTypeId);
    }
}
