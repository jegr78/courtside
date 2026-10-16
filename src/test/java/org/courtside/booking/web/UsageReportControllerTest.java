package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import({BookingTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class UsageReportControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID COURT_CLOSED_CARD = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final Instant MAY_FIFTH = Instant.parse("2026-05-05T08:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID court;
    private UUID adultType;
    private UUID youthType;
    private UUID janePerson;
    private UUID jane;
    private UUID john;
    private UUID board;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        court = facility.createCourt(1, "Centre");
        adultType = members.createMembershipType("Adult");
        youthType = members.createMembershipType("Youth");
        janePerson = identity.createPerson("Jane", "Doe", "jane@example.org");
        UUID johnPerson = identity.createPerson("John", "Roe", "john@example.org");
        members.assignMembership(janePerson, adultType, LocalDate.of(2026, 1, 1));
        members.assignMembership(johnPerson, youthType, LocalDate.of(2026, 1, 1));
        jane = identity.createEnabledAccount(janePerson, "jane", Set.of(Role.MEMBER));
        john = identity.createEnabledAccount(johnPerson, "john", Set.of(Role.MEMBER));
        board = identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "mary",
                Set.of(Role.ADMIN));
    }

    @Test
    void givenBookingsOfTwoCardsAndTwoMembershipTypes_whenReportingTheirDays_thenCapacityIsGroupedByCardAndType()
            throws Exception {
        // given
        booking(MEMBER_BOOKING_CARD, jane, 0, 60);
        booking(MEMBER_BOOKING_CARD, jane, 1, 90);
        booking(MEMBER_BOOKING_CARD, john, 2, 60);
        booking(TRAINING_CARD, john, 3, 120);
        booking(COURT_CLOSED_CARD, board, 4, 600);

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-01").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-05-01"))
                .andExpect(jsonPath("$.to").value("2026-05-10"))
                .andExpect(jsonPath("$.timeZone").value("Europe/Berlin"))
                .andExpect(jsonPath("$.capacity.uses.length()").value(3))
                .andExpect(jsonPath("$.capacity.uses[?(@.cardId == '%s' && @.membershipTypeName == 'Adult')].bookings"
                        .formatted(MEMBER_BOOKING_CARD)).value(2))
                .andExpect(jsonPath("$.capacity.uses[?(@.cardId == '%s' && @.membershipTypeName == 'Adult')].bookedMinutes"
                        .formatted(MEMBER_BOOKING_CARD)).value(150))
                .andExpect(jsonPath("$.capacity.uses[?(@.cardId == '%s' && @.membershipTypeName == 'Youth')].bookings"
                        .formatted(MEMBER_BOOKING_CARD)).value(1))
                .andExpect(jsonPath("$.capacity.uses[?(@.cardId == '%s')].membershipTypeId"
                        .formatted(TRAINING_CARD)).value(youthType.toString()))
                .andExpect(jsonPath("$.capacity.uses[?(@.cardId == '%s')].bookedMinutes"
                        .formatted(TRAINING_CARD)).value(120))
                .andExpect(jsonPath("$.capacity.uses[*].cardId", hasItemNot(COURT_CLOSED_CARD)));
    }

    @Test
    void givenOpenHoursAndABooking_whenReporting_thenItsShareIsMeasuredAgainstTheOpenCourtMinutes() throws Exception {
        // given
        for (java.time.DayOfWeek day : java.time.DayOfWeek.values()) {
            facility.setOpeningHours(day, new org.courtside.shared.OpeningWindow(
                    java.time.LocalTime.of(8, 0), java.time.LocalTime.of(12, 0)));
        }
        booking(MEMBER_BOOKING_CARD, jane, 0, 60);

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-05").param("to", "2026-05-05"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capacity.capacityMinutes").value(240))
                .andExpect(jsonPath("$.capacity.uses[0].share").value(closeTo(0.25, 1e-9)));
    }

    @Test
    void givenCancellationsByTheHolderTheClubAndTheRelease_whenReporting_thenEachIsCountedOnItsOwn() throws Exception {
        // given
        UUID byHolder = booking(MEMBER_BOOKING_CARD, jane, 0, 60);
        UUID byClubInRain = booking(MEMBER_BOOKING_CARD, jane, 1, 60);
        UUID byClubWithoutReason = booking(TRAINING_CARD, john, 2, 60);
        UUID released = booking(MEMBER_BOOKING_CARD, john, 3, 60);
        booking(MEMBER_BOOKING_CARD, john, 4, 60);
        cancel(byHolder, jane, null);
        cancel(byClubInRain, board, CancellationReason.WEATHER);
        cancel(byClubWithoutReason, board, null);
        cancel(released, null, null);
        jdbc.sql("INSERT INTO booking_release (booking_id, released_at) VALUES (:id, :at)")
                .param("id", released).param("at", Timestamp.from(MAY_FIFTH)).update();

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-01").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cancellations.cancelled").value(4))
                .andExpect(jsonPath("$.cancellations.byHolder").value(1))
                .andExpect(jsonPath("$.cancellations.byClub").value(2))
                .andExpect(jsonPath("$.cancellations.released").value(1))
                .andExpect(jsonPath("$.cancellations.reasons.length()").value(2))
                .andExpect(jsonPath("$.cancellations.reasons[0].reason").value("WEATHER"))
                .andExpect(jsonPath("$.cancellations.reasons[0].cancelled").value(1))
                .andExpect(jsonPath("$.cancellations.reasons[1].reason").doesNotExist())
                .andExpect(jsonPath("$.cancellations.reasons[1].cancelled").value(1))
                .andExpect(jsonPath("$.cancellations.cards[?(@.cardId == '%s')].byClub"
                        .formatted(TRAINING_CARD)).value(1))
                .andExpect(jsonPath("$.cancellations.cards[?(@.cardId == '%s')].cancelled"
                        .formatted(MEMBER_BOOKING_CARD)).value(3));
    }

    @Test
    void givenRecordedAttendance_whenReporting_thenAttendedCountingAndLiftedNoShowsAreSeparate() throws Exception {
        // given
        bookings.trackAttendance(null);
        attendance(booking(MEMBER_BOOKING_CARD, jane, 0, 60), "ATTENDED", false);
        attendance(booking(MEMBER_BOOKING_CARD, jane, 1, 60), "NO_SHOW", false);
        attendance(booking(MEMBER_BOOKING_CARD, john, 2, 60), "NO_SHOW", false);
        attendance(booking(MEMBER_BOOKING_CARD, john, 3, 60), "NO_SHOW", true);
        booking(MEMBER_BOOKING_CARD, john, 4, 60);

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-01").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attendance.tracked").value(true))
                .andExpect(jsonPath("$.attendance.attended").value(1))
                .andExpect(jsonPath("$.attendance.noShows").value(2))
                .andExpect(jsonPath("$.attendance.liftedNoShows").value(1));
    }

    @Test
    void givenABookingTheRulesRefuse_whenReportingThatDay_thenTheRefusalIsCountedByItsCodeAndType() throws Exception {
        // given
        TimeSlot yesterday = new TimeSlot(Instant.parse("2026-05-11T08:00:00Z"), Instant.parse("2026-05-11T09:00:00Z"));
        assertThatThrownBy(() -> bookings.createBookingLookingForAPartner(court, MEMBER_BOOKING_CARD, yesterday,
                jane, janePerson))
                .isInstanceOf(BookingRulesViolatedException.class);

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-12").param("to", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ruleRejections.attempts").value(1))
                .andExpect(jsonPath("$.ruleRejections.rules[?(@.code == 'booking.rule.startsInPast')].attempts")
                        .value(1));
        assertThat(jdbc.sql("SELECT membership_type_id FROM booking_rule_rejection").query(UUID.class).list())
                .as("the refusal keeps the holder's membership type and nothing that names them")
                .isNotEmpty().containsOnly(adultType);
    }

    @Test
    void givenTheRejectionRecordRefusesEveryRow_whenTheRulesRefuseABooking_thenTheMemberStillReceivesTheRefusal() {
        // given
        TimeSlot yesterday = new TimeSlot(Instant.parse("2026-05-11T08:00:00Z"), Instant.parse("2026-05-11T09:00:00Z"));
        jdbc.sql("ALTER TABLE booking_rule_rejection ADD CONSTRAINT refuse_every_row CHECK (false)").update();
        try {
            // when / then
            assertThatThrownBy(() -> bookings.createBookingLookingForAPartner(court, MEMBER_BOOKING_CARD, yesterday,
                    jane, janePerson))
                    .as("a count that cannot be written must not replace the refusal")
                    .isInstanceOf(BookingRulesViolatedException.class);
        } finally {
            jdbc.sql("ALTER TABLE booking_rule_rejection DROP CONSTRAINT refuse_every_row").update();
        }
    }

    @Test
    void givenARefusalOutsideThePeriod_whenReporting_thenItIsNotCounted() throws Exception {
        // given
        jdbc.sql("""
                        INSERT INTO booking_rule_rejection (id, attempt_id, rule_code, rejected_at, card_id)
                        VALUES (:id, :attempt, 'booking.rule.startsInPast', :at, :card)
                        """)
                .param("id", UUID.randomUUID()).param("attempt", UUID.randomUUID())
                .param("at", Timestamp.from(Instant.parse("2026-04-30T21:59:00Z")))
                .param("card", MEMBER_BOOKING_CARD).update();

        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-01").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ruleRejections.attempts").value(0))
                .andExpect(jsonPath("$.ruleRejections.rules.length()").value(0));
    }

    @Test
    void givenBookingsOfNamedMembers_whenReporting_thenNoPersonAccountOrBookingIsNamed() throws Exception {
        // given
        UUID held = booking(MEMBER_BOOKING_CARD, jane, 0, 60);
        UUID cancelled = booking(MEMBER_BOOKING_CARD, john, 1, 60);
        cancel(cancelled, board, CancellationReason.OTHER);

        // when
        String body = mockMvc.perform(get("/api/admin/reports/usage")
                        .param("from", "2026-05-01").param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(body).as("an aggregate report names nobody")
                .doesNotContain("Jane", "Doe", "John", "Roe", "jane", "john", "example.org",
                        jane.toString(), john.toString(), board.toString(), janePerson.toString(),
                        held.toString(), cancelled.toString());
    }

    @Test
    @WithMockUser(username = "jane", roles = "MEMBER")
    void givenAMember_whenReadingTheUsageReport_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/usage"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.capacity").doesNotExist());
    }

    @Test
    void givenOnlyTheStart_whenReportingUsage_thenThePeriodIsIncomplete() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/usage").param("from", "2026-05-01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.facilityUtilisation.periodIncomplete"));
    }

    @Test
    void givenNoPeriod_whenReportingUsage_thenTheLastFullMonthIsReported() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/usage"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-04-01"))
                .andExpect(jsonPath("$.to").value("2026-04-30"));
    }

    private static org.hamcrest.Matcher<Iterable<? super String>> hasItemNot(UUID cardId) {
        return org.hamcrest.Matchers.not(hasItem(cardId.toString()));
    }

    private UUID booking(UUID cardId, UUID bookedBy, int dayAfterMayFifth, int minutes) {
        Instant start = MAY_FIFTH.plus(dayAfterMayFifth, ChronoUnit.DAYS);
        return bookings.insertBookingThatHasStarted(court, cardId,
                new TimeSlot(start, start.plus(minutes, ChronoUnit.MINUTES)), bookedBy);
    }

    private void cancel(UUID bookingId, UUID cancelledBy, CancellationReason reason) {
        jdbc.sql("""
                        UPDATE booking SET status = 'CANCELLED', cancelled_at = :at, cancelled_by = :by,
                                           cancellation_reason = :reason
                         WHERE id = :id
                        """)
                .param("at", Timestamp.from(MAY_FIFTH.minus(1, ChronoUnit.DAYS))).param("by", cancelledBy)
                .param("reason", reason == null ? null : reason.name()).param("id", bookingId).update();
        jdbc.sql("UPDATE court_allocation SET status = 'CANCELLED' WHERE booking_id = :id").param("id", bookingId)
                .update();
    }

    private void attendance(UUID bookingId, String outcome, boolean lifted) {
        jdbc.sql("""
                        INSERT INTO booking_attendance (booking_id, outcome, recorded_at, recorded_by, lifted_at, lifted_by)
                        VALUES (:id, :outcome, :at, :by, :liftedAt, :liftedBy)
                        """)
                .param("id", bookingId).param("outcome", outcome).param("at", Timestamp.from(MAY_FIFTH))
                .param("by", board).param("liftedAt", lifted ? Timestamp.from(MAY_FIFTH) : null)
                .param("liftedBy", lifted ? board : null).update();
    }
}
