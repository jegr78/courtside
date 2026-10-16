package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.AvailabilityEntryNotFoundException;
import org.courtside.facility.CourtNotFoundException;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
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
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class AvailabilityEntryImpactTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final LocalDate WEDNESDAY = LocalDate.of(2026, 5, 13);
    private static final OpeningWindow ALL_DAY = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0));
    private static final OpeningWindow UNTIL_FIVE = new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(17, 0));

    @Autowired
    private ImpactService impact;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private UUID courtId;
    private UUID bookingId;

    @BeforeEach
    void aBookingOnWednesdayFromSixToSevenInTheEvening() {
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, ALL_DAY);
        }
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "doe.jane", Set.of(Role.MEMBER));
        UUID playerId = identity.createPerson("John", "Roe", "john.roe@example.org");
        bookingId = bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z")),
                accountId, personId, Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(playerId)), null));
    }

    @Test
    void givenABookingOnItsDay_whenPreviewingAHolidayThatClosesTheClub_thenTheBookingIsCounted() {
        // when
        ImpactService.Impact preview = impact.ofOpeningPeriod(
                null, OpeningPeriod.Kind.HOLIDAY, WEDNESDAY, WEDNESDAY, Map.of(), null, 100);

        // then
        assertThat(preview.affectedCount()).isOne();
        assertThat(preview.bookings()).extracting(ImpactService.AffectedBooking::bookingId)
                .containsExactly(bookingId);
    }

    @Test
    void givenABookingWithinTheHours_whenPreviewingAHolidayThatKeepsThem_thenNothingIsCounted() {
        // when
        ImpactService.Impact preview = impact.ofOpeningPeriod(
                null, OpeningPeriod.Kind.HOLIDAY, WEDNESDAY, WEDNESDAY, everyDay(ALL_DAY), null, 100);

        // then
        assertThat(preview.affectedCount()).isZero();
    }

    @Test
    void givenABookingInTheEvening_whenPreviewingASeasonThatClosesEarlier_thenTheBookingIsCounted() {
        // when
        ImpactService.Impact preview = impact.ofOpeningPeriod(null, OpeningPeriod.Kind.SEASON,
                WEDNESDAY.minusDays(1), WEDNESDAY.plusDays(30), everyDay(UNTIL_FIVE), null, 100);

        // then
        assertThat(preview.affectedCount()).isOne();
    }

    @Test
    void givenASeasonEndingBeforeTheBooking_whenPreviewingIt_thenNothingIsCounted() {
        // when
        ImpactService.Impact preview = impact.ofOpeningPeriod(null, OpeningPeriod.Kind.SEASON,
                WEDNESDAY.minusDays(1), WEDNESDAY.minusDays(1), everyDay(UNTIL_FIVE), null, 100);

        // then
        assertThat(preview.affectedCount()).isZero();
    }

    @Test
    void givenAClosureOfTheBookedCourt_whenPreviewingIt_thenTheBookingIsCountedAndAnotherCourtsIsNot() {
        // given
        UUID otherCourt = facility.createCourt(2, "Court 2");

        // when
        ImpactService.Impact own = impact.ofCourtClosure(null, courtId, WEDNESDAY, WEDNESDAY, null, 100);
        ImpactService.Impact other = impact.ofCourtClosure(null, otherCourt, WEDNESDAY, WEDNESDAY, null, 100);

        // then
        assertThat(own.affectedCount()).isOne();
        assertThat(other.affectedCount()).isZero();
    }

    @Test
    void givenAStoredClosureOverTheBooking_whenPreviewingItWidened_thenTheBookingIsNotCountedAgain() {
        // given
        UUID closureId = facility.closeCourt(courtId, WEDNESDAY, WEDNESDAY.plusDays(1));

        // when
        ImpactService.Impact preview = impact.ofCourtClosure(
                closureId, courtId, WEDNESDAY.minusDays(1), WEDNESDAY.plusDays(5), null, 100);

        // then
        assertThat(preview.affectedCount()).as("its people were told when the closure first covered it")
                .isZero();
    }

    @Test
    void givenAStoredClosureBeforeTheBooking_whenPreviewingItWidenedOverIt_thenTheBookingIsCounted() {
        // given
        UUID closureId = facility.closeCourt(courtId, WEDNESDAY.plusDays(1), WEDNESDAY.plusDays(2));

        // when
        ImpactService.Impact preview = impact.ofCourtClosure(
                closureId, courtId, WEDNESDAY, WEDNESDAY.plusDays(2), null, 100);

        // then
        assertThat(preview.affectedCount()).isOne();
    }

    @Test
    void givenADayAHolidayAlreadyCloses_whenPreviewingAClosureOfTheCourt_thenTheBookingIsNotCountedAgain() {
        // given
        facility.addHoliday(WEDNESDAY, null);

        // when
        ImpactService.Impact preview = impact.ofCourtClosure(null, courtId, WEDNESDAY, WEDNESDAY, null, 100);

        // then
        assertThat(preview.affectedCount()).isZero();
    }

    @Test
    void givenAnUnknownSeason_whenPreviewingAChangeToIt_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> impact.ofOpeningPeriod(UUID.randomUUID(), OpeningPeriod.Kind.SEASON,
                WEDNESDAY, WEDNESDAY, Map.of(), null, 100))
                .isInstanceOf(AvailabilityEntryNotFoundException.class);
    }

    @Test
    void givenAnUnknownCourt_whenPreviewingAClosure_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> impact.ofCourtClosure(null, UUID.randomUUID(), WEDNESDAY, WEDNESDAY, null, 100))
                .isInstanceOf(CourtNotFoundException.class);
    }

    @Test
    void givenDatesAtTheEndOfTheCalendar_whenPreviewingASeason_thenNothingIsCounted() {
        // when
        ImpactService.Impact preview = impact.ofOpeningPeriod(null, OpeningPeriod.Kind.SEASON,
                LocalDate.MAX.minusDays(1), LocalDate.MAX, Map.of(), null, 100);

        // then
        assertThat(preview.affectedCount()).isZero();
    }

    private static Map<DayOfWeek, OpeningWindow> everyDay(OpeningWindow window) {
        return Arrays.stream(DayOfWeek.values()).collect(Collectors.toMap(Function.identity(), day -> window));
    }
}
