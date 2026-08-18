package org.courtside.booking;

import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(FacilityTestFixture.class)
class MultiCourtBookingTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-13T18:00:00Z");

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    private UUID courtOne;
    private UUID courtTwo;
    private UUID courtThree;

    @BeforeEach
    void setUp() {
        courtOne = facilityFixture.createCourt(1, "Court 1");
        courtTwo = facilityFixture.createCourt(2, "Court 2");
        courtThree = facilityFixture.createCourt(3, "Court 3");

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenThreeCourts_whenBookingATrainingBlock_thenOneBookingHoldsThreeAllocations() {
        // when
        UUID bookingId = book(List.of(courtOne, courtTwo, courtThree));

        // then
        Booking booking = bookings.findWithAllocationsById(bookingId).orElseThrow();
        assertThat(booking.getAllocations())
                .hasSize(3)
                .extracting(CourtAllocation::getCourtId)
                .containsExactlyInAnyOrder(courtOne, courtTwo, courtThree);
    }

    @Test
    void givenOneOfThreeCourtsIsTaken_whenBookingAllThree_thenNothingIsCreated() {
        // given
        book(List.of(courtTwo));

        // when / then
        assertThatThrownBy(() -> book(List.of(courtOne, courtTwo, courtThree)))
                .isInstanceOf(CourtUnavailableException.class);

        assertThat(bookings.findAll()).hasSize(1);
    }

    @Test
    void whenBookingWithAnEmptyCourtList_thenTheServiceStillRefusesItsOwnCaller() {
        // given
        // when / then
        assertThatThrownBy(() -> book(List.of()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void whenBookingTheSameCourtTwiceInOneRequest_thenTheServiceStillRefusesItsOwnCaller() {
        // given
        // when / then
        assertThatThrownBy(() -> book(List.of(courtOne, courtOne)))
                .isInstanceOf(IllegalStateException.class);
    }

    private UUID book(List<UUID> courtIds) {
        return bookingService.create(new CreateBookingCommand(
                courtIds, TRAINING_CARD, new TimeSlot(SIX_PM, EIGHT_PM),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));
    }
}
