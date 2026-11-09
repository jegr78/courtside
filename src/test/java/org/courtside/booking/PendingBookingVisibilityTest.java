package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.BookingCounter;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Currency;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class, BookingTestFixture.class})
class PendingBookingVisibilityTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant START = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant END = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EXPIRY = Instant.parse("2026-05-12T10:15:00Z");
    private static final UUID BALL_MACHINE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final TimeSlot SLOT = new TimeSlot(START, END);

    @Autowired
    private BookingService service;
    @Autowired
    private BookingRepository bookings;
    @Autowired
    private CourtAllocationRepository allocations;
    @Autowired
    private BookingCounter counter;
    @Autowired
    private BookingStatistics statistics;
    @Autowired
    private BookingTestFixture bookingFixture;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;

    private UUID court;
    private UUID holderAccount;
    private UUID holderPerson;
    private UUID otherPerson;
    private UUID otherAccount;
    private UUID pending;

    @BeforeEach
    void aPendingBookingOnOneCourt() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holderPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        holderAccount = identity.createEnabledAccount(holderPerson, "doe.jane", Set.of(Role.MEMBER));
        members.holdRunningMembership(holderPerson);
        otherPerson = identity.createPerson("John", "Roe", "john.roe@example.org");
        otherAccount = identity.createEnabledAccount(otherPerson, "roe.john", Set.of(Role.MEMBER));
        members.holdRunningMembership(otherPerson);
        pending = bookingFixture.createPendingBooking(court, MEMBER_CARD, SLOT, holderAccount, EXPIRY);
    }

    @Test
    void givenAPendingBooking_whenTheCourtPlanIsRead_thenTheSlotIsOccupied() {
        // when
        List<CourtAllocation> plan = service.allocationsBetween(START.minus(Duration.ofHours(1)), END);

        // then
        assertThat(plan).as("court plan allocations").extracting(a -> a.getBooking().getId())
                .containsExactly(pending);
        assertThat(allocations.findOccupancies(List.of(court), START, END))
                .as("occupancies of the court").hasSize(1);
        assertThat(allocations.findOccupiedCourtsExcluding(List.of(court), START, END, List.of(UUID.randomUUID())))
                .as("courts occupied for a series").containsExactly(court);
    }

    @Test
    void givenAPendingBooking_whenTheSameCourtIsRequested_thenCourtUnavailableComesFromThePreCheck() {
        // when / then
        assertThatThrownBy(() -> service.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT,
                otherAccount, otherPerson, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Example Guest")), null)))
                .isInstanceOf(CourtUnavailableException.class)
                .hasMessageContaining("already occupied")
                .hasNoCause();
        assertThat(allocations.existsOccupyingOverlapping(List.of(court), START, END))
                .as("overlap pre-check").isTrue();
        assertThat(bookings.count()).as("no booking was inserted").isEqualTo(1);
    }

    @Test
    void givenAPendingBooking_whenTheBookersHourLimitIsEvaluated_thenItCounts() {
        // when
        Duration booked = counter.bookedTimeStartingBetween(holderAccount, START.minus(Duration.ofHours(1)), END,
                Set.of());
        Duration bookedWithoutOther = counter.bookedTimeStartingBetween(holderAccount,
                START.minus(Duration.ofHours(1)), END, Set.of(UUID.randomUUID()));
        long open = counter.countOpenBookingsOf(holderAccount, START.minus(Duration.ofHours(2)));

        // then
        assertThat(booked).as("booked time").isEqualTo(Duration.ofHours(1));
        assertThat(bookedWithoutOther).as("booked time with an unrelated exclusion").isEqualTo(Duration.ofHours(1));
        assertThat(open).as("open bookings").isEqualTo(1);
    }

    @Test
    void givenAPendingBooking_whenRemindersAccessGrantsAndStatisticsRun_thenItIsAbsent() {
        // given
        jdbc.sql("UPDATE booking_card SET grants_access = true WHERE id = ?").param(MEMBER_CARD).update();
        Instant now = START.minus(Duration.ofHours(1));
        LocalDate day = LocalDate.parse("2026-05-12");

        // when / then
        assertThat(bookings.findDueForReminder(now, 24)).as("reminders").isEmpty();
        assertThat(bookings.findGrantingAccessOnCourtsStartingBefore(List.of(court), END, now,
                new UUID(0, 0), 10)).as("access grants").isEmpty();
        assertThat(bookings.existsOpeningDoorsBookedBy(holderAccount, now)).as("door opener").isFalse();
        assertThat(allocations.findConfirmedStartingBetween(START, END)).as("ledger export").isEmpty();
        assertThat(allocations.nextSignallingStarts(now, END)).as("occupancy signal").isEmpty();
        assertThat(statistics.bookingFigures(day, day).confirmed()).as("confirmed bookings").isZero();
        assertThat(statistics.utilisationTotals(day, day).bookedMinutes()).as("booked minutes").isZero();
    }

    @Test
    void givenAPendingBooking_whenTheOwnerListsTheirBookings_thenItShowsAsPendingWithItsExpiry() throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        // when
        PersonalBookingPage upcoming = service.personalBookings(holderAccount, PersonalBookingView.UPCOMING, null, 10);

        // then
        assertThat(upcoming.bookings()).as("upcoming list").extracting(Booking::getId).containsExactly(pending);
        mockMvc.perform(get("/api/my/bookings").with(SecurityMockMvcRequestPostProcessors.user(
                        userDetails.loadUserByUsername("doe.jane"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(pending.toString()))
                .andExpect(jsonPath("$.items[0].status").value("PENDING_PAYMENT"))
                .andExpect(jsonPath("$.items[0].paymentExpiresAt").value("2026-05-12T10:15:00Z"));
        mockMvc.perform(get("/api/my/bookings").with(SecurityMockMvcRequestPostProcessors.user(
                        userDetails.loadUserByUsername("roe.john"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void givenAPendingBooking_whenCardCapacityAndUpcomingGuardsAreRead_thenItCounts() {
        // given
        UUID secondCourt = facility.createCourt(2, "Court 2");
        Booking charged = new Booking(MEMBER_CARD, otherAccount, null, START.minus(Duration.ofDays(3)));
        charged.allocate(secondCourt, SLOT);
        charged.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        charged.charge(new BookingAmount(1500, Currency.getInstance("EUR")));
        charged.awaitPayment(EXPIRY);
        bookings.saveAndFlush(charged);
        Instant now = START.minus(Duration.ofHours(2));

        // when
        long cardUsage = bookings.countCardUsageOverlapping(BALL_MACHINE, START, END);
        long cardUsageExcluding = bookings.countCardUsageOverlappingExcluding(BALL_MACHINE, START, END,
                List.of(UUID.randomUUID()));
        boolean upcomingBooked = bookings.existsUpcomingBookedBy(otherAccount, now);
        boolean upcomingCharged = bookings.existsUpcomingCharged(now);

        // then
        SoftAssertions.assertSoftly(softly -> {
            softly.assertThat(cardUsage).as("card usage").isEqualTo(1);
            softly.assertThat(cardUsageExcluding).as("card usage with an exclusion").isEqualTo(1);
            softly.assertThat(upcomingBooked).as("upcoming booking held by the account").isTrue();
            softly.assertThat(upcomingCharged).as("upcoming charged booking").isTrue();
        });
    }

    @Test
    void givenAPendingBooking_whenTheBoardReadsItsDetailAndTheSubjectAccessExport_thenBothShowItPending()
            throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID adminPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(adminPerson, "miles.richard", Set.of(Role.ADMIN));
        var admin = SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername("miles.richard"));

        // when / then
        mockMvc.perform(get("/api/managed/bookings/{id}", pending).with(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING_PAYMENT"));
        mockMvc.perform(post("/api/admin/export/person/{personId}", holderPerson).with(admin).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingsMade[0].bookingId").value(pending.toString()))
                .andExpect(jsonPath("$.bookingsMade[0].status").value("PENDING_PAYMENT"));
    }

    @Test
    void givenAPendingBooking_whenTheBoardListsUpcomingAppointments_thenItIsListedWithItsStatus() throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID adminPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        identity.createEnabledAccount(adminPerson, "miles.richard", Set.of(Role.ADMIN));
        var admin = SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername("miles.richard"));

        // when / then
        mockMvc.perform(get("/api/managed/bookings").with(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(pending.toString()))
                .andExpect(jsonPath("$.items[0].status").value("PENDING_PAYMENT"));
    }

    @Test
    void givenAPendingBookingThatIsThenConfirmed_whenTheOwnerListsTheirBookings_thenTheExpiryIsGone()
            throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        jdbc.sql("UPDATE court_allocation SET status = 'CONFIRMED' WHERE booking_id = ?").param(pending).update();
        jdbc.sql("UPDATE booking SET status = 'CONFIRMED' WHERE id = ?").param(pending).update();

        // when / then
        mockMvc.perform(get("/api/my/bookings").with(SecurityMockMvcRequestPostProcessors.user(
                        userDetails.loadUserByUsername("doe.jane"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].status").value("CONFIRMED"))
                .andExpect(jsonPath("$.items[0].paymentExpiresAt").doesNotExist());
    }
}
