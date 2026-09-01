package org.courtside.rules;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
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

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class CancellationDeadlineRuleTest extends AbstractIntegrationTest {

    private static final UUID YOUTH_RULE_SET =
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID YOUTH =
            UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant START = Instant.parse("2026-05-12T16:00:00Z");

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingRepository bookingRepository;

    @Autowired
    private RuleAdminService ruleAdmin;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private MeterRegistry meters;

    private UUID courtId;
    private UUID accountId;
    private UUID personId;

    @BeforeEach
    void setUp() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(
                    LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        accountId = identity.createEnabledAccount(personId, "jane", Set.of(Role.MEMBER));
        members.assignMembership(personId, YOUTH);
    }

    @Test
    void givenTheCancellationDeadlineHasPassed_whenCancelling_thenTheRuleRefusesIt() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.CANCELLATION_DEADLINE,
                Map.of("minMinutes", 361));
        UUID bookingId = createBooking();
        double rejectedBefore = rejectionCount();

        // when
        BookingRulesViolatedException failure = catchThrowableOfType(
                BookingRulesViolatedException.class,
                () -> bookings.cancel(bookingId, accountId, Set.of(Role.MEMBER)));

        // then
        assertThat(failure.getViolations()).containsExactly(new RuleViolation(
                "booking.rule.cancellationDeadline.exceeded", Map.of("minMinutes", 361)));
        assertThat(bookingRepository.findById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
        assertThat(rejectionCount()).isEqualTo(rejectedBefore + 1);
    }

    @Test
    void givenCancellationOccursAtTheDeadline_whenCancelling_thenItIsAllowed() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.CANCELLATION_DEADLINE,
                Map.of("minMinutes", 360));
        UUID bookingId = createBooking();

        // when
        bookings.cancel(bookingId, accountId, Set.of(Role.MEMBER));

        // then
        assertThat(bookingRepository.findById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
    }

    @Test
    void givenTheCancellationDeadlineHasPassed_whenAnAdministratorCancels_thenItIsAllowed() {
        // given
        ruleAdmin.setRule(YOUTH_RULE_SET, RuleType.CANCELLATION_DEADLINE,
                Map.of("minMinutes", 361));
        UUID bookingId = createBooking();

        // when
        bookings.cancel(bookingId, UUID.randomUUID(), Set.of(Role.ADMIN));

        // then
        assertThat(bookingRepository.findById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
    }

    private UUID createBooking() {
        return bookings.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(START, START.plusSeconds(3600)), accountId, personId,
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Partner")), null));
    }

    private double rejectionCount() {
        var counter = meters.find("courtside.bookings.rejected")
                .tag("rule", "booking.rule.cancellationDeadline.exceeded")
                .counter();
        return counter == null ? 0 : counter.count();
    }
}
