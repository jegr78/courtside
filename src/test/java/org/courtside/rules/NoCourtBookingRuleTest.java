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
import org.courtside.shared.OpeningWindow;
import org.courtside.rules.internal.NoCourtBookingRule;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.shared.TimeSlot;
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
class NoCourtBookingRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID YOUTH_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private NoCourtBookingRule rule;

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

    @org.junit.jupiter.api.BeforeEach
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
    void givenARuleSetThatBarsBooking_whenAHolderOfItChecks_thenTheBarIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());

        // when
        var violations = rule.check(contextFor(YOUTH));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.noCourtBooking");
    }

    @Test
    void givenARuleSetThatBarsBooking_whenAnotherMembershipTypeChecks_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());

        // when
        var violations = rule.check(contextFor(ACTIVE));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenNoRuleSetBarsBooking_whenChecking_thenNothingIsReported() {
        // when
        var violations = rule.check(contextFor(YOUTH));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTheClubRuleSetBarsBooking_whenSomebodyHoldsNoMembershipType_thenTheBarStillApplies() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);

        // when — taking the membership away is what this closes: without the club-level set the
        // bar would end with the membership that carried it
        var violations = rule.check(contextFor(null));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.noCourtBooking");
    }

    @Test
    void givenARuleSetThatBarsBooking_whenAHolderBooks_thenTheBookingIsRefusedWithThatCode() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class, () -> book(Role.MEMBER));

        // then
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.noCourtBooking");
    }

    @Test
    void givenARuleSetThatBarsBooking_whenAnAdministratorBooks_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());

        // when — the bar states who may book, and the role itself is the override
        UUID bookingId = book(Role.ADMIN);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenARuleSetThatBarsBooking_whenATrainerBooks_thenTheBookingIsStillRefused() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.NO_COURT_BOOKING, Map.of());

        // when — only ADMIN sets a restriction aside; no other role does
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class, () -> book(Role.TRAINER));

        // then
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.noCourtBooking");
    }

    private UUID book(Role role) {
        Instant from = Instant.parse("2026-05-13T16:00:00Z");
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(from, from.plus(1, ChronoUnit.HOURS)), booker, bookerPersonId,
                Set.of(role), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private RuleContext contextFor(UUID membershipTypeId) {
        Instant start = Instant.parse("2026-05-13T18:00:00Z");
        return new RuleContext(UUID.randomUUID(), UUID.randomUUID(),
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(), membershipTypeId);
    }
}
