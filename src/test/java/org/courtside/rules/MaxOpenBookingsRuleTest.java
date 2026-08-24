package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.internal.MaxOpenBookingsRule;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, ConfigTestFixture.class,
        MemberTestFixture.class})
class MaxOpenBookingsRuleTest extends AbstractIntegrationTest {

    private static final UUID STANDARD = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private MaxOpenBookingsRule rule;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ConfigTestFixture clubConfiguration;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtId;
    private final UUID member = UUID.randomUUID();
    private UUID bookerPersonId;

    @BeforeEach
    void setUp() {
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
    }

    @Test
    void givenALimitOfTwoAndOneOpenBooking_whenChecking_thenNoViolation() {
        // given
        book("2026-05-13T16:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenALimitOfTwoAndTwoOpenBookings_whenChecking_thenExceededViolation() {
        // given
        book("2026-05-13T16:00:00Z");
        book("2026-05-13T17:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.maxOpenBookings.exceeded");
    }

    @Test
    void givenOneOfTwoBookingsCancelled_whenChecking_thenTheCancelledOneDoesNotCount() {
        // given
        UUID first = book("2026-05-13T16:00:00Z");
        book("2026-05-13T17:00:00Z");
        bookingService.cancel(first, member, Set.of());

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTwoBookingsThatHaveAlreadyEnded_whenChecking_thenTheyDoNotCount() {
        // given
        insertHistoricalBooking("2026-05-11T16:00:00Z");
        insertHistoricalBooking("2026-05-11T17:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenABookingEndingExactlyAtTheClockInstant_whenChecking_thenItDoesNotCountAsOpen() {
        // given
        insertHistoricalBooking("2026-05-12T09:00:00Z");
        book("2026-05-13T16:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenTwoBookingsOnACardOutsideTheLimits_whenChecking_thenTheyDoNotCount() {
        // given
        bookTraining("2026-05-13T16:00:00Z");
        bookTraining("2026-05-13T17:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenNoMembershipTypeAndNoClubRuleSet_whenChecking_thenNothingBoundsTheBookings() {
        // given
        book("2026-05-13T16:00:00Z");
        book("2026-05-13T17:00:00Z");

        // when
        var violations = rule.check(contextFor(null));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenAClubRuleSetForPeopleWithoutAMembershipType_whenCheckingWithoutOne_thenItsLimitBinds() {
        // given
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);
        book("2026-05-13T16:00:00Z");

        // when
        var violations = rule.check(contextFor(null));

        // then
        assertThat(violations).extracting(RuleViolation::code)
                .containsExactly("booking.rule.maxOpenBookings.exceeded");
        assertThat(violations).singleElement()
                .extracting(violation -> violation.params().get("limit")).isEqualTo(1);
    }

    @Test
    void givenAClubRuleSet_whenTheMemberHoldsAMembershipType_thenItsOwnRuleSetStillDecides() {
        // given
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);
        book("2026-05-13T16:00:00Z");

        // when
        var violations = rule.check(contextFor(STANDARD));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenAMembershipTypeThatNamesNoRuleSet_whenChecking_thenTheClubRuleSetDoesNotStandIn() {
        // given
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);
        UUID measuredByNothing = members.createMembershipType("Honorary");
        book("2026-05-13T16:00:00Z");

        // when
        var violations = rule.check(contextFor(measuredByNothing));

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenAClubRuleSetForPeopleWithoutAMembershipType_whenBookingPastItsLimit_thenTheBookingIsRefused() {
        // given
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(YOUTH_RULE_SET);
        book("2026-05-13T16:00:00Z");

        // when
        BookingRulesViolatedException refusal = catchThrowableOfType(
                BookingRulesViolatedException.class, () -> book("2026-05-13T17:00:00Z"));

        // then
        assertThat(refusal.getViolations()).extracting(RuleViolation::code)
                .contains("booking.rule.maxOpenBookings.exceeded");
    }

    private UUID book(String start) {
        return book(MEMBER_BOOKING_CARD, Role.MEMBER, start,
                List.of(ParticipantSpec.guest("Partner")));
    }

    private UUID bookTraining(String start) {
        return book(TRAINING_CARD, Role.TRAINER, start, List.of());
    }

    private void insertHistoricalBooking(String start) {
        UUID bookingId = UUID.randomUUID();
        Instant from = Instant.parse(start);
        jdbc.sql("""
                        INSERT INTO booking (id, card_id, status, booked_by)
                        VALUES (:id, :cardId, 'CONFIRMED', :bookedBy)
                        """)
                .param("id", bookingId)
                .param("cardId", MEMBER_BOOKING_CARD)
                .param("bookedBy", member)
                .update();
        jdbc.sql("""
                        INSERT INTO court_allocation
                            (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (:id, :bookingId, :courtId, :startsAt, :endsAt, 'CONFIRMED')
                        """)
                .param("id", UUID.randomUUID())
                .param("bookingId", bookingId)
                .param("courtId", courtId)
                .param("startsAt", from.atOffset(ZoneOffset.UTC))
                .param("endsAt", from.plus(1, ChronoUnit.HOURS).atOffset(ZoneOffset.UTC))
                .update();
    }

    private UUID book(UUID cardId, Role role, String start, List<ParticipantSpec> participants) {
        Instant from = Instant.parse(start);
        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId,
                new TimeSlot(from, from.plus(1, ChronoUnit.HOURS)), member, bookerPersonId,
                Set.of(role), null, participants, null));
    }

    private RuleContext contextFor(UUID membershipTypeId) {
        Instant start = Instant.parse("2026-05-13T18:00:00Z");
        return new RuleContext(
                courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                member, membershipTypeId);
    }
}
