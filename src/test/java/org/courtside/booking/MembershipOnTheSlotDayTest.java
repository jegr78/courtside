package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.CardService;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.rules.testfixture.RulesTestFixture;
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
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import({ConfigTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class,
        RulesTestFixture.class})
class MembershipOnTheSlotDayTest extends AbstractIntegrationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);
    private static final LocalDate CHANGE = LocalDate.of(2026, 5, 15);

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private ConfigTestFixture club;

    @Autowired
    private CardService cards;

    private UUID card;

    private UUID court;
    private UUID jane;
    private UUID janeAccount;

    @BeforeEach
    void setUp() {
        court = facility.createCourt(1, "Court 1");
        card = cards.createCard("Members only", "#B85C38", Set.of(Role.MEMBER), Set.of(), new short[]{},
                false, false, false).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        members.addMembershipPeriod(jane, members.createMembershipType("Adults"), TODAY.minusYears(1), CHANGE);
    }

    @Test
    void givenATypeThatBarsBookingFromNextWeek_whenBookingASlotAfterTheChange_thenThatTypeMeasuresIt() {
        // given
        members.addMembershipPeriod(jane, barred("Passive"), CHANGE, null);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> bookings.create(bookingOn(CHANGE.plusDays(1))));

        // then
        assertThat(refusal).as("the period valid on the slot's day decides its rules").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code).contains("booking.rule.noCourtBooking");
    }

    @Test
    void givenATypeThatBarsBookingFromNextWeek_whenBookingASlotBeforeTheChange_thenTheCurrentTypeMeasuresIt() {
        // given
        members.addMembershipPeriod(jane, barred("Passive"), CHANGE, null);

        // when / then
        assertThat(bookings.create(bookingOn(CHANGE.minusDays(1)))).isNotNull();
    }

    @Test
    void givenAMembershipEndingBeforeTheSlot_whenBookingIt_thenTheRulesForPeopleWithoutATypeMeasureIt() {
        // given
        club.bindPeopleWithoutAMembershipTypeTo(rules.ruleSetBarringCourtBookings("No membership"));

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> bookings.create(bookingOn(CHANGE.plusDays(1))));

        // then
        assertThat(refusal).as("nobody books as a member for a day their membership no longer covers").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code).contains("booking.rule.noCourtBooking");
    }

    @Test
    void givenOnlyAPeriodThatBeginsNextMonth_whenBookingASlotInsideIt_thenItGrantsNothingYet() {
        // given
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        members.addMembershipPeriod(john, members.createMembershipType("Juniors"), TODAY.plusMonths(1), null);
        club.bindPeopleWithoutAMembershipTypeTo(rules.ruleSetBarringCourtBookings("No membership"));
        Instant start = TODAY.plusMonths(1).plusDays(1).atTime(16, 0).toInstant(java.time.ZoneOffset.UTC);

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(BookingRulesViolatedException.class,
                () -> bookings.create(new CreateBookingCommand(List.of(court), card,
                        new TimeSlot(start, start.plusSeconds(3600)), johnAccount, john, Set.of(Role.MEMBER),
                        null, List.of(), null)));

        // then
        assertThat(refusal).as("a period that has not begun grants no booking, whatever day it is for").isNotNull();
        assertThat(refusal.getViolations()).extracting(RuleViolation::code).contains("booking.rule.noCourtBooking");
    }

    private UUID barred(String name) {
        return members.membershipTypeMeasuredBy(name, rules.ruleSetBarringCourtBookings(name));
    }

    private CreateBookingCommand bookingOn(LocalDate day) {
        Instant start = day.atTime(16, 0).toInstant(java.time.ZoneOffset.UTC);
        return new CreateBookingCommand(List.of(court), card, new TimeSlot(start, start.plusSeconds(3600)),
                janeAccount, jane, Set.of(Role.MEMBER), null, List.of(), null);
    }
}
