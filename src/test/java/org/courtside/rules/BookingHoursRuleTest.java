package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.FacilityService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.internal.BookingHoursRule;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import({ConfigTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class})
class BookingHoursRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID YOUTH_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final LocalDate WEDNESDAY = LocalDate.of(2026, 5, 13);
    private static final Map<String, Integer> NINE_TO_EIGHT = Map.of("earliestStart", 540, "latestEnd", 1200);

    @Autowired
    private BookingHoursRule rule;

    @Autowired
    private RuleAdminService ruleAdmin;

    @Autowired
    private ConfigTestFixture clubConfiguration;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityService facility;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private UUID courtId;
    private UUID youthPersonId;
    private UUID activePersonId;

    @BeforeEach
    void openTheFacilityUntilTenAtNight() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facilityFixture.createCourt(1, "Court 1");
        youthPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        members.assignMembership(youthPersonId, YOUTH);
        activePersonId = identity.createPerson("John", "Roe", "john@example.org");
        members.assignMembership(activePersonId, ACTIVE);
    }

    @Test
    void givenAYouthBookingWindow_whenABookingEndsAfterIt_thenTheWindowIsReportedWithItsTimes() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, LocalTime.of(19, 30), 60));

        // then
        assertThat(violations).singleElement().satisfies(violation -> {
            assertThat(violation.code()).isEqualTo("booking.rule.bookingHours.outside");
            assertThat(violation.params())
                    .isEqualTo(Map.of("earliestStart", "09:00", "latestEnd", "20:00"));
        });
    }

    @Test
    void givenAYouthBookingWindow_whenABookingStartsBeforeIt_thenTheWindowIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, LocalTime.of(8, 0), 60));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.bookingHours.outside");
    }

    @Test
    void givenAYouthBookingWindow_whenABookingFillsItExactly_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, LocalTime.of(9, 0), 660));

        // then
        assertThat(violations).as("both edges of the window belong to it").isEmpty();
    }

    @Test
    void givenAYouthBookingWindow_whenTheSlotFitsInUtcButNotInTheClubZone_thenItIsMeasuredInTheClubZone() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);
        Instant sixToSevenUtc = Instant.parse("2026-05-13T18:00:00Z");
        RuleContext context = new RuleContext(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(sixToSevenUtc, sixToSevenUtc.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(), YOUTH);

        // when
        List<RuleViolation> violations = rule.check(context);

        // then
        assertThat(violations).as("18:00 to 19:00 UTC is 20:00 to 21:00 in Europe/Berlin, past the window")
                .extracting(RuleViolation::code)
                .containsExactly("booking.rule.bookingHours.outside");
    }

    @Test
    void givenAWindowUntilTheLastMinuteOfTheDay_whenASlotRunsPastMidnight_thenTheWindowIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS,
                Map.of("earliestStart", 0, "latestEnd", 1439));

        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, LocalTime.of(23, 0), 120));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.bookingHours.outside");
    }

    @Test
    void givenAYouthBookingWindow_whenAnotherMembershipTypeChecks_thenNothingIsReported() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        List<RuleViolation> violations = rule.check(contextFor(ACTIVE, LocalTime.of(21, 0), 60));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenNoRuleSetCarriesAWindow_whenChecking_thenNothingIsReported() {
        // when
        List<RuleViolation> violations = rule.check(contextFor(YOUTH, LocalTime.of(21, 0), 60));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTheClubRuleSetCarriesAWindow_whenSomebodyHoldsNoMembershipType_thenItStillApplies() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);

        // when
        List<RuleViolation> violations = rule.check(contextFor(null, LocalTime.of(21, 0), 60));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.bookingHours.outside");
    }

    @Test
    void givenAYouthBookingWindow_whenAYouthMemberBooksPastIt_thenTheBookingIsRefusedNamingTheWindow() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> book(youthPersonId, Role.MEMBER, LocalTime.of(20, 0)));

        // then
        assertThat(refusal).as("a youth member booking 20:00 to 21:00 must be refused").isNotNull();
        assertThat(refusal.getViolations()).anySatisfy(violation -> {
            assertThat(violation.code()).isEqualTo("booking.rule.bookingHours.outside");
            assertThat(violation.params())
                    .isEqualTo(Map.of("earliestStart", "09:00", "latestEnd", "20:00"));
        });
    }

    @Test
    void givenAYouthBookingWindow_whenAMemberOfAnotherTypeBooksPastIt_thenTheBookingIsWrittenAndTheOpeningHoursStand() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        UUID bookingId = book(activePersonId, Role.MEMBER, LocalTime.of(21, 0));

        // then
        assertThat(bookingId).isNotNull();
        assertThat(facility.openingSchedule().windowOn(WEDNESDAY))
                .contains(new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
    }

    @Test
    void givenAWindowCoveringTheWholeDay_whenAYouthMemberBooksBeforeTheFacilityOpens_thenTheOpeningHoursStillRefuseIt() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS,
                Map.of("earliestStart", 0, "latestEnd", 1439));

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> book(youthPersonId, Role.MEMBER, LocalTime.of(6, 0)));

        // then
        assertThat(refusal).as("a booking window narrows the opening hours and never widens them")
                .isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.openingHours.outside")
                .doesNotContain("booking.rule.bookingHours.outside");
    }

    @Test
    void givenAYouthBookingWindow_whenAYouthMemberBooksInsideIt_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        UUID bookingId = book(youthPersonId, Role.MEMBER, LocalTime.of(19, 0));

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenAYouthBookingWindow_whenAnAdministratorBooksPastItForAYouthMember_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.BOOKING_HOURS, NINE_TO_EIGHT);

        // when
        UUID bookingId = book(youthPersonId, Role.ADMIN, LocalTime.of(21, 0));

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void whenAskingTheRuleWhetherItJudgesAMove_thenItDoes() {
        // when / then
        assertThat(rule.appliesToAMove())
                .as("a move that carries a booking out of the window must be refused like a new one")
                .isTrue();
        assertThat(rule.isOverridable()).as("an administrator overrides the window").isTrue();
    }

    private UUID book(UUID personId, Role role, LocalTime localStart) {
        TimeSlot slot = clubSlot(localStart, 60);
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, slot, UUID.randomUUID(), personId,
                Set.of(role), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private RuleContext contextFor(UUID membershipTypeId, LocalTime localStart, int minutes) {
        return new RuleContext(courtId, MEMBER_BOOKING_CARD, clubSlot(localStart, minutes),
                UUID.randomUUID(), membershipTypeId);
    }

    private static TimeSlot clubSlot(LocalTime localStart, int minutes) {
        Instant start = WEDNESDAY.atTime(localStart).atZone(ZoneId.of("Europe/Berlin")).toInstant();
        return new TimeSlot(start, start.plus(minutes, ChronoUnit.MINUTES));
    }
}
