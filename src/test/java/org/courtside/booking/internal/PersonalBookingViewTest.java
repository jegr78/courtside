package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.booking.PersonalBookingView;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class PersonalBookingViewTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID janeAccountId;
    private UUID janePersonId;
    private UUID johnPersonId;

    @BeforeEach
    void aClubWithOneCourt() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        janePersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccountId = identity.createEnabledAccount(janePersonId, "doe.jane", Set.of(Role.MEMBER));
        johnPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
    }

    @Test
    void givenBookingsFurtherAheadThanOnePage_whenListingUpcoming_thenTheSoonestLeadsTheFirstPage() {
        // given
        UUID nextWeek = bookedAt(Instant.parse("2026-05-19T16:00:00Z"));
        UUID tomorrow = bookedAt(Instant.parse("2026-05-13T16:00:00Z"));
        UUID nextMonth = bookedAt(Instant.parse("2026-06-12T16:00:00Z"));

        // when
        PersonalBookingPage first = bookings.personalBookings(janeAccountId, PersonalBookingView.UPCOMING, null, 1);

        // then
        assertThat(idsOf(first.bookings()))
                .as("the member's next booking is on the first page, however much lies beyond it")
                .containsExactly(tomorrow);
        assertThat(walk(PersonalBookingView.UPCOMING)).containsExactly(tomorrow, nextWeek, nextMonth);
    }

    @Test
    void givenPastAndUpcomingBookings_whenListingEachView_thenEveryBookingIsInExactlyOne() {
        // given
        UUID upcoming = bookedAt(Instant.parse("2026-05-13T16:00:00Z"));
        UUID lastWeek = bookedAt(Instant.parse("2026-05-14T16:00:00Z"));
        UUID yesterday = bookedAt(Instant.parse("2026-05-15T16:00:00Z"));
        moveTo(lastWeek, Instant.parse("2026-05-05T16:00:00Z"));
        moveTo(yesterday, Instant.parse("2026-05-11T16:00:00Z"));

        // when
        List<UUID> upcomingView = walk(PersonalBookingView.UPCOMING);
        List<UUID> history = walk(PersonalBookingView.HISTORY);

        // then
        assertThat(upcomingView).containsExactly(upcoming);
        assertThat(history).as("history is read from the most recent booking backwards")
                .containsExactly(yesterday, lastWeek);
    }

    @Test
    void givenABookingStillUnderway_whenListingEachView_thenItIsUpcomingUntilItEnds() {
        // given
        UUID underway = bookedAt(Instant.parse("2026-05-13T16:00:00Z"));
        moveTo(underway, NOW.minus(Duration.ofMinutes(30)));

        // when / then
        assertThat(walk(PersonalBookingView.UPCOMING)).containsExactly(underway);
        assertThat(walk(PersonalBookingView.HISTORY)).isEmpty();
    }

    @Test
    void givenAFirstUpcomingPage_whenItsCursorEndsBeforeTheNextPage_thenPagingContinues() {
        // given
        UUID tomorrow = bookedAt(Instant.parse("2026-05-13T16:00:00Z"));
        UUID nextWeek = bookedAt(Instant.parse("2026-05-19T16:00:00Z"));
        PersonalBookingPage first = bookings.personalBookings(janeAccountId, PersonalBookingView.UPCOMING, null, 1);
        assertThat(idsOf(first.bookings())).containsExactly(tomorrow);
        moveTo(tomorrow, NOW.minus(Duration.ofDays(1)));

        // when
        PersonalBookingPage next = bookings.personalBookings(
                janeAccountId, PersonalBookingView.UPCOMING, first.nextCursor(), 1);

        // then
        assertThat(idsOf(next.bookings()))
                .as("the cursor remains an ordering anchor after its booking leaves the upcoming view")
                .containsExactly(nextWeek);
    }

    private List<UUID> walk(PersonalBookingView view) {
        List<UUID> walked = new ArrayList<>();
        UUID cursor = null;
        do {
            PersonalBookingPage page = bookings.personalBookings(janeAccountId, view, cursor, 1);
            walked.addAll(idsOf(page.bookings()));
            cursor = page.nextCursor();
        } while (cursor != null && walked.size() < 10);
        return walked;
    }

    private void moveTo(UUID bookingId, Instant startsAt) {
        jdbc.sql("""
                UPDATE court_allocation SET starts_at = :startsAt, ends_at = :endsAt
                WHERE booking_id = :bookingId
                """)
                .param("startsAt", Timestamp.from(startsAt))
                .param("endsAt", Timestamp.from(startsAt.plus(Duration.ofHours(1))))
                .param("bookingId", bookingId)
                .update();
    }

    private UUID bookedAt(Instant startsAt) {
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_BOOKING_CARD,
                new TimeSlot(startsAt, startsAt.plus(Duration.ofHours(1))), janeAccountId, janePersonId,
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(johnPersonId)), null));
    }

    private static List<UUID> idsOf(List<Booking> page) {
        return page.stream().map(Booking::getId).toList();
    }
}
