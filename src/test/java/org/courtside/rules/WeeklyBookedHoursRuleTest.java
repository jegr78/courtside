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
import org.courtside.rules.internal.BookingRule;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.WeeklyBookedHoursRule;
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
class WeeklyBookedHoursRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final LocalDate WEDNESDAY = LocalDate.of(2026, 5, 13);
    private static final LocalDate THURSDAY = LocalDate.of(2026, 5, 14);
    private static final LocalDate NEXT_MONDAY = LocalDate.of(2026, 5, 18);
    private static final Map<String, Integer> TWO_HOURS = Map.of("maxHours", 2);

    @Autowired
    private WeeklyBookedHoursRule rule;

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

    private final UUID account = UUID.randomUUID();
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
        ruleAdmin.removeRule(STANDARD_RULE_SET, RuleType.MAX_OPEN_BOOKINGS);
    }

    @Test
    void givenNinetyMinutesBookedThisWeek_whenAnotherHourWouldPassTwoHours_thenTheLimitAndTheBookedTimeAreReported() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        book(WEDNESDAY, LocalTime.of(10, 0), 90, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> book(THURSDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.MEMBER));

        // then
        assertThat(refusal).as("90 booked minutes plus 60 pass a two-hour week").isNotNull();
        assertThat(refusal.getViolations()).anySatisfy(violation -> {
            assertThat(violation.code()).isEqualTo("booking.rule.weeklyBookedHours.exceeded");
            assertThat(violation.params()).isEqualTo(Map.of("maxHours", 2, "bookedMinutes", 90L));
        });
    }

    @Test
    void givenAnHourBookedThisWeek_whenAnotherHourReachesTheLimitExactly_thenTheBookingIsWritten() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        book(WEDNESDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        UUID bookingId = book(THURSDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.MEMBER);

        // then
        assertThat(bookingId).as("reaching the limit is allowed, only passing it is refused").isNotNull();
    }

    @Test
    void givenTheWeekIsFull_whenBookingOnTheNextMonday_thenTheNewWeekStartsEmpty() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        book(WEDNESDAY, LocalTime.of(10, 0), 120, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        UUID bookingId = book(NEXT_MONDAY, LocalTime.of(8, 0), 120, MEMBER_BOOKING_CARD, Role.MEMBER);

        // then
        assertThat(bookingId).as("a club-local week starts on Monday").isNotNull();
    }

    @Test
    void givenACancelledBookingThisWeek_whenBookingAgain_thenTheCancelledTimeDoesNotCount() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        UUID cancelled = book(WEDNESDAY, LocalTime.of(10, 0), 120, MEMBER_BOOKING_CARD, Role.MEMBER);
        bookingService.cancel(cancelled, account, Set.of(Role.MEMBER));

        // when
        UUID bookingId = book(THURSDAY, LocalTime.of(10, 0), 120, MEMBER_BOOKING_CARD, Role.MEMBER);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenATrainingThatDoesNotCountAgainstLimits_whenBookingAMemberHour_thenTheTrainingIsNotCounted() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, Map.of("maxHours", 1));
        book(WEDNESDAY, LocalTime.of(10, 0), 120, TRAINING_CARD, Role.TRAINER);

        // when
        UUID bookingId = book(THURSDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.MEMBER);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenAFullWeek_whenBookingATrainingThatDoesNotCountAgainstLimits_thenTheRuleLeavesItAlone() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, Map.of("maxHours", 1));
        book(WEDNESDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        List<RuleViolation> violations = rule.check(context(TRAINING_CARD, THURSDAY, LocalTime.of(10, 0), 60));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenAFullWeek_whenAnAdministratorBooksForTheMember_thenTheLimitIsOverridden() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        book(WEDNESDAY, LocalTime.of(10, 0), 120, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        UUID bookingId = book(THURSDAY, LocalTime.of(10, 0), 60, MEMBER_BOOKING_CARD, Role.ADMIN);

        // then
        assertThat(bookingId).isNotNull();
    }

    @Test
    void givenNoWeeklyLimit_whenBookingManyHours_thenNothingIsReported() {
        // given
        book(WEDNESDAY, LocalTime.of(8, 0), 240, MEMBER_BOOKING_CARD, Role.MEMBER);

        // when
        List<RuleViolation> violations = rule.check(context(MEMBER_BOOKING_CARD, THURSDAY, LocalTime.of(8, 0), 240));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTwoOccurrencesInOneWeekJudgedTogether_whenTogetherTheyPassTheLimit_thenTheSecondIsRefused() {
        // given
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.WEEKLY_BOOKED_HOURS, TWO_HOURS);
        BookingRule.Prepared prepared = rule.prepare();

        // when
        List<RuleViolation> first = prepared.check(context(MEMBER_BOOKING_CARD, WEDNESDAY, LocalTime.of(10, 0), 90));
        List<RuleViolation> second = prepared.check(context(MEMBER_BOOKING_CARD, THURSDAY, LocalTime.of(10, 0), 90));
        List<RuleViolation> nextWeek = prepared.check(
                context(MEMBER_BOOKING_CARD, NEXT_MONDAY, LocalTime.of(10, 0), 90));

        // then
        assertThat(first).isEmpty();
        assertThat(second).as("a series must not pass the week one occurrence at a time")
                .extracting(RuleViolation::code).containsExactly("booking.rule.weeklyBookedHours.exceeded");
        assertThat(nextWeek).isEmpty();
    }

    @Test
    void whenAskingTheRuleWhetherItJudgesAMove_thenItDoesNotAndAnAdministratorOverridesIt() {
        // when / then
        assertThat(rule.appliesToAMove()).as("a move adds no booking to the week").isFalse();
        assertThat(rule.isOverridable()).isTrue();
    }

    private UUID book(LocalDate day, LocalTime start, int minutes, UUID cardId, Role role) {
        List<ParticipantSpec> participants = cardId.equals(TRAINING_CARD)
                ? List.of() : List.of(ParticipantSpec.guest("Partner"));
        return bookingService.create(new CreateBookingCommand(List.of(courtId), cardId,
                clubSlot(day, start, minutes), account, personId, Set.of(role), null, participants, null));
    }

    private RuleContext context(UUID cardId, LocalDate day, LocalTime start, int minutes) {
        return new RuleContext(courtId, cardId, clubSlot(day, start, minutes), account, ACTIVE);
    }

    private static TimeSlot clubSlot(LocalDate day, LocalTime start, int minutes) {
        Instant from = day.atTime(start).atZone(ZoneId.of("Europe/Berlin")).toInstant();
        return new TimeSlot(from, from.plus(minutes, ChronoUnit.MINUTES));
    }
}
