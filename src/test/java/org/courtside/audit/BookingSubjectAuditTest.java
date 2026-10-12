package org.courtside.audit;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({BookingTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class})
class BookingSubjectAuditTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID STANDARD_MEMBERSHIP = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final ZoneId CLUB_ZONE = ZoneId.of("Europe/Berlin");
    private static final TimeSlot WEDNESDAY_EVENING = new TimeSlot(
            Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private SqlStatementCounter queries;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UUID administratorAccountId;
    private UUID administratorPersonId;
    private UUID centreCourt;
    private UUID backCourt;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        administratorPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        members.assignMembership(administratorPersonId, STANDARD_MEMBERSHIP);
        administratorAccountId = identity.createEnabledAccount(
                administratorPersonId, "doe.jane", Set.of(Role.ADMIN));
        administrator = userDetailsService.loadUserByUsername("doe.jane");
        backCourt = facility.createCourt(2, "Back Court");
        centreCourt = facility.createCourt(1, "Centre Court");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @AfterEach
    void stopCountingQueries() {
        queries.pause();
    }

    @Test
    void givenABookingOnTwoCourts_whenItsEntryIsRead_thenTheSubjectNamesTheCourtsInCourtOrderAndTheSlot()
            throws Exception {
        // given
        UUID bookingId = bookings.createBookingOnCourts(List.of(backCourt, centreCourt), TRAINING_CARD,
                WEDNESDAY_EVENING, administratorPersonId, Set.of(Role.ADMIN));

        // when
        String body = readLogAbout(bookingId);

        // then
        assertThat((String) JsonPath.read(body, "$.entries[0].eventType")).isEqualTo("booking.booking.confirmed");
        assertThat((String) JsonPath.read(body, "$.entries[0].subjectName"))
                .as("a booking is named by its courts, in court order, and by nobody who plays on them")
                .isEqualTo("Centre Court, Back Court");
        assertThat(periodOf(body, 0)).isEqualTo(WEDNESDAY_EVENING);
    }

    @Test
    void givenACancelledBooking_whenItsCancellationIsRead_thenItStillNamesItsCourtAndSlot() throws Exception {
        // given
        UUID bookingId = bookings.createBookingOnCourts(List.of(centreCourt), TRAINING_CARD,
                WEDNESDAY_EVENING, administratorPersonId, Set.of(Role.ADMIN));
        bookings.cancelBooking(bookingId, administratorAccountId, Set.of(Role.ADMIN));

        // when
        String body = readLogAbout(bookingId);

        // then
        List<String> eventTypes = JsonPath.read(body, "$.entries[*].eventType");
        int cancellation = eventTypes.indexOf("booking.booking.cancelled");
        assertThat(cancellation).as("the cancellation is recorded").isNotNegative();
        assertThat((String) JsonPath.read(body, "$.entries[" + cancellation + "].subjectName"))
                .isEqualTo("Centre Court");
        assertThat(periodOf(body, cancellation)).as("a cancelled booking keeps the slot it held")
                .isEqualTo(WEDNESDAY_EVENING);
    }

    @Test
    void givenASeries_whenItsCreationIsRead_thenTheSubjectNamesItsCourtAndItsFirstOccurrence() throws Exception {
        // given
        UUID seriesId = bookings.createSeries(backCourt, TRAINING_CARD, LocalDate.of(2026, 5, 14),
                LocalTime.of(18, 0), 90, 3, administratorAccountId, administratorPersonId, Set.of(Role.ADMIN));

        // when
        String body = readLogAbout(seriesId);

        // then
        assertThat((String) JsonPath.read(body, "$.entries[0].eventType")).isEqualTo("booking.series.created");
        assertThat((String) JsonPath.read(body, "$.entries[0].subjectName")).isEqualTo("Back Court");
        Instant firstStart = LocalDate.of(2026, 5, 14).atTime(18, 0).atZone(CLUB_ZONE).toInstant();
        assertThat(periodOf(body, 0)).as("a series is described by its first occurrence")
                .isEqualTo(new TimeSlot(firstStart, firstStart.plusSeconds(90 * 60)));
    }

    @Test
    void givenAMovedSeries_whenItsEntriesAreRead_thenEachShowsTheTimeTheSeriesHoldsToday() throws Exception {
        // given
        UUID seriesId = bookings.createSeries(backCourt, TRAINING_CARD, LocalDate.of(2026, 5, 14),
                LocalTime.of(18, 0), 90, 3, administratorAccountId, administratorPersonId, Set.of(Role.ADMIN));
        bookings.moveWholeSeries(seriesId, LocalTime.of(19, 0), administratorAccountId, Set.of(Role.ADMIN));

        // when
        String body = readLogAbout(seriesId);

        // then
        Instant movedStart = LocalDate.of(2026, 5, 14).atTime(19, 0).atZone(CLUB_ZONE).toInstant();
        TimeSlot movedSlot = new TimeSlot(movedStart, movedStart.plusSeconds(90 * 60));
        List<String> eventTypes = JsonPath.read(body, "$.entries[*].eventType");
        assertThat(eventTypes).containsExactlyInAnyOrder("booking.series.created", "booking.series.moved");
        assertThat(periodOf(body, eventTypes.indexOf("booking.series.moved"))).isEqualTo(movedSlot);
        assertThat(periodOf(body, eventTypes.indexOf("booking.series.created")))
                .as("an entry shows the time the series holds today, not the time it held when recorded")
                .isEqualTo(movedSlot);
    }

    @Test
    void givenASeriesWhoseFirstOccurrenceWasCancelled_whenBothEntriesShareAPage_thenEachIsDescribed()
            throws Exception {
        // given
        UUID seriesId = bookings.createSeries(backCourt, TRAINING_CARD, LocalDate.of(2026, 5, 14),
                LocalTime.of(18, 0), 90, 3, administratorAccountId, administratorPersonId, Set.of(Role.ADMIN));
        UUID firstOccurrence = bookings.firstOccurrenceOf(seriesId);
        bookings.cancelBooking(firstOccurrence, administratorAccountId, Set.of(Role.ADMIN));

        // when
        String body = mockMvc.perform(get("/api/admin/audit").param("limit", "100").with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        Instant firstStart = LocalDate.of(2026, 5, 14).atTime(18, 0).atZone(CLUB_ZONE).toInstant();
        TimeSlot firstSlot = new TimeSlot(firstStart, firstStart.plusSeconds(90 * 60));
        List<String> eventTypes = JsonPath.read(body, "$.entries[*].eventType");
        int creation = eventTypes.indexOf("booking.series.created");
        int cancellation = eventTypes.indexOf("booking.booking.cancelled");
        assertThat((String) JsonPath.read(body, "$.entries[" + creation + "].subjectName"))
                .as("the series stays described while its first occurrence is on the same page")
                .isEqualTo("Back Court");
        assertThat(periodOf(body, creation)).isEqualTo(firstSlot);
        assertThat((String) JsonPath.read(body, "$.entries[" + cancellation + "].subjectName")).isEqualTo("Back Court");
        assertThat(periodOf(body, cancellation)).isEqualTo(firstSlot);
    }

    @Test
    void givenAnEntryAboutABookingNothingResolves_whenItIsRead_thenItCarriesNeitherNameNorPeriod()
            throws Exception {
        // given
        UUID vanishedBooking = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO domain_event (id, event_type, subject_id, occurred_at, payload)
                VALUES (?, ?, ?, ?, CAST(? AS jsonb))
                """, UUID.randomUUID(), "booking.booking.cancelled", vanishedBooking,
                Timestamp.from(clock.instant()), "{\"bookingId\":\"" + vanishedBooking + "\"}");

        // when
        String body = readLogAbout(vanishedBooking);

        // then
        List<Object> names = JsonPath.read(body, "$.entries[?(@.subjectName != null)]");
        List<Object> periods = JsonPath.read(body, "$.entries[?(@.subjectPeriod != null)]");
        assertThat(names).as("nothing names a booking that no longer resolves").isEmpty();
        assertThat(periods).as("nothing times a booking that no longer resolves").isEmpty();
        assertThat((String) JsonPath.read(body, "$.entries[0].subjectId")).isEqualTo(vanishedBooking.toString());
    }

    @Test
    void givenACourtName_whenTheLogIsSearchedForIt_thenTheBookingOnThatCourtIsFound() throws Exception {
        // given
        UUID bookingId = bookings.createBookingOnCourts(List.of(backCourt), TRAINING_CARD,
                WEDNESDAY_EVENING, administratorPersonId, Set.of(Role.ADMIN));
        UUID otherCourtBooking = bookings.createBookingOnCourts(List.of(centreCourt), TRAINING_CARD,
                WEDNESDAY_EVENING, administratorPersonId, Set.of(Role.ADMIN));

        // when
        String body = mockMvc.perform(post("/api/admin/audit/search").with(user(administrator)).with(csrf())
                        .contentType("application/json")
                        .content("{\"query\":\"back court\",\"eventType\":\"booking.booking.confirmed\",\"limit\":50}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        List<String> subjects = JsonPath.read(body, "$.entries[*].subjectId");
        assertThat(subjects).containsExactly(bookingId.toString())
                .as("a booking on another court does not match").doesNotContain(otherCourtBooking.toString());
    }

    @Test
    void givenMoreBookingsAndSeriesOnAPage_whenThePageIsRead_thenItCostsNoMoreStatements() throws Exception {
        // given
        bookings.createBookingOnCourts(List.of(centreCourt), TRAINING_CARD,
                WEDNESDAY_EVENING, administratorPersonId, Set.of(Role.ADMIN));
        long oneBooking = statementsForAPage();
        for (int day = 1; day <= 4; day++) {
            bookings.createBookingOnCourts(List.of(centreCourt, backCourt), TRAINING_CARD,
                    new TimeSlot(WEDNESDAY_EVENING.start().plusSeconds(day * 86_400L),
                            WEDNESDAY_EVENING.end().plusSeconds(day * 86_400L)),
                    administratorPersonId, Set.of(Role.ADMIN));
        }
        for (int week = 1; week <= 3; week++) {
            bookings.createSeries(backCourt, TRAINING_CARD, LocalDate.of(2026, 5, 18).plusWeeks(week * 4L),
                    LocalTime.of(9, 0), 60, 3, administratorAccountId, administratorPersonId, Set.of(Role.ADMIN));
        }

        // when
        long manyBookingsAndSeries = statementsForAPage();

        // then
        assertThat(manyBookingsAndSeries)
                .as("bookings and series on a page are described in one batch, not one by one")
                .isEqualTo(oneBooking);
    }

    private long statementsForAPage() throws Exception {
        queries.reset();
        mockMvc.perform(get("/api/admin/audit").param("limit", "100").with(user(administrator)))
                .andExpect(status().isOk());
        long total = queries.snapshot().total();
        queries.pause();
        return total;
    }

    private String readLogAbout(UUID subjectId) throws Exception {
        return mockMvc.perform(get("/api/admin/audit").param("subjectId", subjectId.toString())
                        .with(user(administrator)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static TimeSlot periodOf(String body, int index) {
        Object period = JsonPath.read(body, "$.entries[" + index + "].subjectPeriod");
        assertThat(period).as("entry %d carries a period", index).isNotNull();
        String startsAt = JsonPath.read(body, "$.entries[" + index + "].subjectPeriod.startsAt");
        String endsAt = JsonPath.read(body, "$.entries[" + index + "].subjectPeriod.endsAt");
        return new TimeSlot(Instant.parse(startsAt), Instant.parse(endsAt));
    }
}
