package org.courtside.booking;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.card.CardService;
import org.courtside.card.BookingCard;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID LEAGUE_MATCH_CARD =
            UUID.fromString("33333333-3333-3333-3333-333333333333");

    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-12T18:00:00Z");

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CardService cards;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MeterRegistry meters;

    private UUID courtId;
    private final UUID someUser = UUID.randomUUID();
    private UUID bookerPersonId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(
                    day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void whenCreatingABooking_thenItHasOneConfirmedCourtAllocation() {
        // given
        double createdBefore = counter("courtside.bookings.created");

        // when
        UUID bookingId = bookingService.create(command(SIX_PM, SEVEN_PM));

        // then
        Booking booking = bookings.findWithAllocationsById(bookingId).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.getAllocations()).singleElement().satisfies(allocation -> {
            assertThat(allocation.getCourtId()).isEqualTo(courtId);
            assertThat(allocation.getStartsAt()).isEqualTo(SIX_PM);
        });
        assertThat(counter("courtside.bookings.created")).isEqualTo(createdBefore + 1);
    }

    @Test
    void givenAnExistingBooking_whenCreatingAnOverlappingOne_thenCourtUnavailableIsThrown() {
        // given
        bookingService.create(command(SIX_PM, EIGHT_PM));
        double conflictsBefore = counter("courtside.bookings.conflicts");

        // when / then
        assertThatThrownBy(() -> bookingService.create(command(SEVEN_PM, EIGHT_PM)))
                .isInstanceOf(CourtUnavailableException.class);
        assertThat(counter("courtside.bookings.conflicts")).isEqualTo(conflictsBefore + 1);
    }

    @Test
    void givenABookingStartingInThePast_whenCreating_thenItIsRejectedWithoutBeingStored() {
        // given
        Instant start = Instant.parse("2026-05-12T09:00:00Z");
        double rejectedBefore = counter("courtside.bookings.rejected", "rule", "booking.rule.startsInPast");

        // when / then
        assertThatThrownBy(() -> bookingService.create(command(
                start, start.plus(1, ChronoUnit.HOURS))))
                .isInstanceOfSatisfying(BookingRulesViolatedException.class, failure ->
                        assertThat(failure.getViolations()).extracting(RuleViolation::code)
                                .contains("booking.rule.startsInPast"));
        assertThat(bookings.count()).isZero();
        assertThat(counter("courtside.bookings.rejected", "rule", "booking.rule.startsInPast"))
                .isEqualTo(rejectedBefore + 1);
    }

    private double counter(String name, String... tags) {
        var counter = meters.find(name).tags(tags).counter();
        return counter == null ? 0 : counter.count();
    }

    @Test
    void givenAnIdempotentReplay_whenCreating_thenOnlyThePersistedBookingIsCounted() {
        // given
        String idempotencyKey = UUID.randomUUID().toString();
        CreateBookingCommand command = command(SIX_PM, SEVEN_PM);
        double createdBefore = counter("courtside.bookings.created");

        // when
        UUID first = bookingService.create(command, idempotencyKey);
        UUID replay = bookingService.create(command, idempotencyKey);

        // then
        assertThat(replay).isEqualTo(first);
        assertThat(counter("courtside.bookings.created")).isEqualTo(createdBefore + 1);
    }

    @ParameterizedTest
    @MethodSource("invalidIdempotencyKeys")
    void givenAnInvalidIdempotencyKey_whenCreating_thenCallerBugIsReported(String idempotencyKey) {
        // when / then
        assertThatThrownBy(() -> bookingService.create(command(SIX_PM, SEVEN_PM), idempotencyKey))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The idempotency key must be 1 to 128 visible ASCII characters");
        assertThat(bookings.count()).isZero();
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
    void givenAnAlreadyCancelledBooking_whenCancelledAgain_thenOriginalAuditValuesRemain() {
        // given
        UUID originalActor = UUID.randomUUID();
        Booking booking = new Booking(MEMBER_BOOKING_CARD, someUser, null, SIX_PM);
        booking.allocate(courtId, new TimeSlot(SIX_PM, SEVEN_PM));
        booking.cancel(originalActor, SEVEN_PM);

        // when
        booking.cancel(UUID.randomUUID(), EIGHT_PM);

        // then
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(booking.getCancelledBy()).isEqualTo(originalActor);
        assertThat(booking.getCancelledAt()).isEqualTo(SEVEN_PM);
        assertThat(booking.getAllocations()).singleElement()
                .extracting(CourtAllocation::getStatus)
                .isEqualTo(BookingStatus.CANCELLED);
    }

    @Test
    void givenAnAlreadyCancelledBooking_whenAnUnrelatedMemberCancels_thenItStillReadsAsNotFound() {
        // given
        UUID bookingId = bookingService.create(command(SIX_PM, SEVEN_PM));
        bookingService.cancel(bookingId, someUser, Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> bookingService.cancel(
                bookingId, UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotFoundException.class)
                .hasMessageContaining("may not manage");
        assertThat(bookings.findById(bookingId).orElseThrow().getCancelledBy()).isEqualTo(someUser);
    }

    @Test
    void givenALeagueMatchCreatedByASportDirector_whenAYouthDirectorCancels_thenTheActorIsRecorded() {
        // given
        UUID sportDirector = UUID.randomUUID();
        UUID youthDirector = UUID.randomUUID();
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(courtId), LEAGUE_MATCH_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                sportDirector, null, Set.of(Role.SPORT_DIRECTOR), null, List.of(), null));

        // when
        bookingService.cancel(bookingId, youthDirector, Set.of(Role.YOUTH_DIRECTOR));

        // then
        Booking booking = bookings.findById(bookingId).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(booking.getCancelledBy()).isEqualTo(youthDirector);
    }

    @Test
    void givenALeagueMatchCreatedByASportDirector_whenAnUnrelatedMemberCancels_thenItReadsAsNotFound() {
        // given
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(courtId), LEAGUE_MATCH_CARD, new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), null, Set.of(Role.SPORT_DIRECTOR), null, List.of(), null));

        // when / then
        assertThatThrownBy(() -> bookingService.cancel(
                bookingId, UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotFoundException.class)
                        .hasMessageContaining("may not manage");
    }

    @Test
    void givenAYouthDirectorsCardAccessWasRevoked_whenCancellingAnotherOfficersBooking_thenItReadsAsNotFound() {
        // given
        BookingCard card = cards.createCard("Club championship", "#3A4A5C",
                Set.of(Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR),
                Set.of(Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR), new short[0], false, false, false);
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(courtId), card.getId(), new TimeSlot(SIX_PM, SEVEN_PM),
                UUID.randomUUID(), null, Set.of(Role.SPORT_DIRECTOR), null, List.of(), null));
        cards.changeCard(card.getId(), card.getLabel(), card.getColor(), Set.of(Role.SPORT_DIRECTOR),
                Set.of(Role.SPORT_DIRECTOR), card.getAllowedPlayerCounts(), card.isCountsAgainstLimits(), card.isGuestAllowed(),
                card.isShowGenericOccupancy());

        // when / then
        assertThatThrownBy(() -> bookingService.cancel(
                bookingId, UUID.randomUUID(), Set.of(Role.YOUTH_DIRECTOR)))
                .isInstanceOf(BookingNotFoundException.class)
                        .hasMessageContaining("may not manage");
    }

    @Test
    void givenABookingAtSix_whenListingAllocationsInAPeriod_thenOnlyOverlappingOnesAreReturned() {
        // given
        bookingService.create(command(SIX_PM, SEVEN_PM));

        // when / then
        assertThat(bookingService.allocationsBetween(SIX_PM, EIGHT_PM)).hasSize(1);
        assertThat(bookingService.allocationsBetween(SEVEN_PM, EIGHT_PM)).isEmpty();
    }

    @ParameterizedTest
    @MethodSource("invalidPageLimits")
    void givenAnInvalidPageLimit_whenListingPersonalBookings_thenItIsRejected(int limit) {
        // when / then
        assertThatThrownBy(() -> bookingService.personalBookings(someUser, null, limit))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Personal booking page size must be between 1 and 100");
    }

    private CreateBookingCommand command(Instant start, Instant end) {
        return new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD, new TimeSlot(start, end), someUser, bookerPersonId,
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Partner")), null);
    }

    private static Stream<String> invalidIdempotencyKeys() {
        return Stream.of(null, "", "contains whitespace", "ä", "x".repeat(129));
    }

    private static Stream<Integer> invalidPageLimits() {
        return Stream.of(Integer.MIN_VALUE, 0, 101, Integer.MAX_VALUE);
    }
}
