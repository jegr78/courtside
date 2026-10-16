package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.internal.NoShowLimitRule;
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

@Import({BookingTestFixture.class, ConfigTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class})
class NoShowLimitRuleTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final TimeSlot THURSDAY = new TimeSlot(Instant.parse("2026-05-14T09:00:00Z"),
            Instant.parse("2026-05-14T10:00:00Z"));

    @Autowired
    private NoShowLimitRule rule;

    @Autowired
    private RuleAdminService ruleAdmin;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private UUID courtId;
    private UUID personId;
    private UUID account;
    private UUID board;

    @BeforeEach
    void setUp() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(6, 0), LocalTime.of(22, 0)));
        }
        courtId = facility.createCourt(1, "Court 1");
        personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        account = identity.createEnabledAccount(personId, "jane", Set.of(Role.MEMBER));
        members.assignMembership(personId, ACTIVE);
        board = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "mary",
                Set.of(Role.ADMIN));
        ruleAdmin.setRule(STANDARD_RULE_SET, RuleType.NO_SHOW_LIMIT, Map.of("maxNoShows", 2, "windowDays", 30));
    }

    @Test
    void givenTwoNoShowsInTheWindow_whenTheMemberBooks_thenTheLimitRefusesItWithTheCountAndTheWindow() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);
        noShowDaysAgo(10);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> book(Role.MEMBER));

        // then
        assertThat(refusal).as("two counting no-shows reach a limit of two").isNotNull();
        assertThat(refusal.getViolations()).anySatisfy(violation -> {
            assertThat(violation.code()).isEqualTo("booking.rule.noShowLimit.reached");
            assertThat(violation.params()).isEqualTo(Map.of("maxNoShows", 2, "windowDays", 30, "noShows", 2L));
        });
    }

    @Test
    void givenOneNoShow_whenTheMemberBooks_thenTheBookingIsWritten() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);

        // when
        List<RuleViolation> violations = rule.check(context());

        // then
        assertThat(violations).as("one no-show stays below a limit of two").isEmpty();
    }

    @Test
    void givenAnOldNoShow_whenItStartedBeforeTheWindow_thenItNoLongerCounts() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);
        noShowDaysAgo(31);

        // when
        List<RuleViolation> violations = rule.check(context());

        // then
        assertThat(violations).as("a no-show 31 days ago lies outside a 30-day window").isEmpty();
    }

    @Test
    void givenPastBookingsWithNothingRecorded_whenTheMemberBooks_thenAnUnrecordedAttendanceCountsForNothing() {
        // given
        bookings.trackAttendance(null);
        startedDaysAgo(3);
        startedDaysAgo(5);
        startedDaysAgo(7);

        // when
        List<RuleViolation> violations = rule.check(context());

        // then
        assertThat(violations).as("a booking nobody recorded attendance for is never a no-show").isEmpty();
    }

    @Test
    void givenTheLimitIsReached_whenTheBoardLiftsTheNoShows_thenTheMemberMayBookAgain() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);
        noShowDaysAgo(10);

        // when
        int lifted = bookings.liftNoShows(personId, board);

        // then
        assertThat(lifted).isEqualTo(2);
        assertThat(rule.check(context())).as("lifted no-shows stay recorded but count no longer").isEmpty();
        assertThat(book(Role.MEMBER)).isNotNull();
    }

    @Test
    void givenNoShowsRecorded_whenTheClubSwitchesAttendanceOff_thenTheyCountForNothing() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);
        noShowDaysAgo(10);

        // when
        bookings.stopTrackingAttendance();

        // then
        assertThat(rule.check(context())).as("a club that does not record attendance keeps today's behaviour")
                .isEmpty();
    }

    @Test
    void givenTheLimitIsReached_whenAnAdministratorBooks_thenTheOverrideAdmitsIt() {
        // given
        bookings.trackAttendance(null);
        noShowDaysAgo(3);
        noShowDaysAgo(10);

        // when
        UUID booked = book(Role.ADMIN);

        // then
        assertThat(booked).as("the no-show limit is an overridable membership rule").isNotNull();
        assertThat(rule.isOverridable()).isTrue();
        assertThat(rule.appliesToAMove()).as("a move adds no booking").isFalse();
    }

    private void noShowDaysAgo(int days) {
        bookings.recordNoShow(startedDaysAgo(days), board);
    }

    private UUID startedDaysAgo(int days) {
        Instant start = NOW.minus(days, ChronoUnit.DAYS);
        return bookings.insertBookingThatHasStarted(courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)), account);
    }

    private UUID book(Role role) {
        return bookingService.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD, THURSDAY,
                account, personId, Set.of(role), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private RuleContext context() {
        return new RuleContext(courtId, MEMBER_BOOKING_CARD, THURSDAY, account, ACTIVE);
    }
}
