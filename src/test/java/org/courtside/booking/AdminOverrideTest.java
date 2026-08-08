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
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdminOverrideTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID STANDARD_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final Instant SIX_AM = Instant.parse("2026-05-13T04:00:00Z");
    private static final Instant SEVEN_AM = Instant.parse("2026-05-13T05:00:00Z");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

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

    @Autowired
    private MemberRepository members;

    private UUID courtId;
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
    void givenACardRequiringATrainer_whenAnAdminBooksIt_thenItIsAccepted() {
        // when
        UUID bookingId = book(TRAINING_CARD, Role.ADMIN, SIX_PM, SEVEN_PM);

        // then
        assertThat(bookings.findWithAllocationsById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenAnAdvanceWindowOfSevenDays_whenAnAdminBooksBeyondIt_thenItIsAccepted() {
        // given
        UUID personId = persons.save(new Person("John", "Roe", "john@example.org")).getId();
        members.save(new Member(personId, STANDARD_MEMBERSHIP));

        // when
        UUID bookingId = bookAs(personId, Role.ADMIN, TRAINING_CARD,
                SIX_PM.plus(30, ChronoUnit.DAYS));

        // then
        assertThat(bookings.findWithAllocationsById(bookingId).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    void givenAnAdvanceWindowOfSevenDays_whenAMemberBooksBeyondIt_thenItIsRejected() {
        // given
        UUID personId = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();
        members.save(new Member(personId, STANDARD_MEMBERSHIP));

        // when / then
        assertThatThrownBy(() -> bookAs(personId, Role.MEMBER, MEMBER_BOOKING_CARD,
                SIX_PM.plus(30, ChronoUnit.DAYS)))
                .isInstanceOf(BookingRulesViolatedException.class);
    }

    @Test
    void givenASlotBeforeOpeningHours_whenATrainerBooksIt_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> book(TRAINING_CARD, Role.TRAINER, SIX_AM, SEVEN_AM))
                .isInstanceOf(BookingRulesViolatedException.class);
    }

    @Test
    void givenASlotBeforeOpeningHours_whenAnAdminBooksIt_thenItIsRejectedToo() {
        // when / then
        assertThatThrownBy(() -> book(TRAINING_CARD, Role.ADMIN, SIX_AM, SEVEN_AM))
                .isInstanceOf(BookingRulesViolatedException.class)
                .extracting("violations")
                .satisfies(violations -> assertThat((List<?>) violations)
                        .extracting("code")
                        .containsExactly("booking.rule.openingHours.outside"));
    }

    @Test
    void givenASlotOffTheGrid_whenAnAdminBooksIt_thenItIsRejectedToo() {
        // when / then
        assertThatThrownBy(() -> book(TRAINING_CARD, Role.ADMIN,
                SIX_PM.plus(7, ChronoUnit.MINUTES), SEVEN_PM))
                .isInstanceOf(BookingRulesViolatedException.class);
    }

    @Test
    void givenAnExistingBooking_whenAnAdminBooksAnOverlappingOne_thenCourtUnavailableIsThrown() {
        // given
        book(MEMBER_BOOKING_CARD, Role.MEMBER, SIX_PM, SEVEN_PM);

        // when / then
        assertThatThrownBy(() -> book(TRAINING_CARD, Role.ADMIN, SIX_PM, SEVEN_PM))
                .isInstanceOf(CourtUnavailableException.class);
    }

    private UUID book(UUID cardId, Role role, Instant start, Instant end) {
        List<ParticipantSpec> participants = cardId.equals(MEMBER_BOOKING_CARD)
                ? List.of(ParticipantSpec.guest("Richard Miles"))
                : List.of();

        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, new TimeSlot(start, end),
                UUID.randomUUID(), bookerPersonId, Set.of(role), null, participants, null));
    }

    private UUID bookAs(UUID personId, Role role, UUID cardId, Instant start) {
        List<ParticipantSpec> participants = cardId.equals(MEMBER_BOOKING_CARD)
                ? List.of(ParticipantSpec.guest("Richard Miles"))
                : List.of();

        return bookingService.create(new CreateBookingCommand(
                List.of(courtId), cardId, new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                UUID.randomUUID(), personId, Set.of(role), null, participants, null));
    }
}
