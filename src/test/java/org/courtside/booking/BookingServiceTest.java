package org.courtside.booking;

import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookingServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-12T18:00:00Z");

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    private UUID courtId;
    private final UUID someUser = UUID.randomUUID();
    private UUID bookerPersonId;

    @BeforeEach
    void setUp() {
        courtId = courts.save(new Court(1, "Court 1")).getId();
        bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void whenCreatingABooking_thenItHasOneConfirmedCourtAllocation() {
        // when
        UUID bookingId = bookingService.create(command(SIX_PM, SEVEN_PM));

        // then
        Booking booking = bookings.findWithAllocationsById(bookingId).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.getAllocations()).singleElement().satisfies(allocation -> {
            assertThat(allocation.getCourtId()).isEqualTo(courtId);
            assertThat(allocation.getStartsAt()).isEqualTo(SIX_PM);
        });
    }

    @Test
    void givenAnExistingBooking_whenCreatingAnOverlappingOne_thenCourtUnavailableIsThrown() {
        // given
        bookingService.create(command(SIX_PM, EIGHT_PM));

        // when / then
        assertThatThrownBy(() -> bookingService.create(command(SEVEN_PM, EIGHT_PM)))
                .isInstanceOf(CourtUnavailableException.class);
    }

    @Test
    void givenACancelledBooking_whenBookingTheSameSlotAgain_thenItSucceeds() {
        // given
        UUID first = bookingService.create(command(SIX_PM, EIGHT_PM));
        bookingService.cancel(first, someUser, Set.of());

        // when
        UUID second = bookingService.create(command(SIX_PM, EIGHT_PM));

        // then
        assertThat(second).isNotEqualTo(first);
        assertThat(bookings.findWithAllocationsById(first).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
    }

    @Test
    void givenAConfirmedBooking_whenCancelled_thenItsAllocationIsCancelledToo() {
        // given
        UUID bookingId = bookingService.create(command(SIX_PM, SEVEN_PM));

        // when
        bookingService.cancel(bookingId, someUser, Set.of());

        // then
        Booking booking = bookings.findWithAllocationsById(bookingId).orElseThrow();
        assertThat(booking.getAllocations()).singleElement()
                .extracting(CourtAllocation::getStatus)
                .isEqualTo(BookingStatus.CANCELLED);
    }

    @Test
    void givenABookingAtSix_whenListingAllocationsInAPeriod_thenOnlyOverlappingOnesAreReturned() {
        // given
        bookingService.create(command(SIX_PM, SEVEN_PM));

        // when / then
        assertThat(bookingService.allocationsBetween(SIX_PM, EIGHT_PM)).hasSize(1);
        assertThat(bookingService.allocationsBetween(SEVEN_PM, EIGHT_PM)).isEmpty();
    }

    private CreateBookingCommand command(Instant start, Instant end) {
        return new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(start, end), someUser, bookerPersonId,
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Partner")), null);
    }
}
