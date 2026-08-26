package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.booking.PersonalBookingPage;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
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
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class CursorVisibilityTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant TWO_PM = Instant.parse("2026-05-13T14:00:00Z");
    private static final Instant THREE_PM = Instant.parse("2026-05-13T15:00:00Z");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");
    private static final int PAGE_LIMIT = 50;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private ManagedAppointmentQuery managed;

    @Autowired
    private CardService cards;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private UUID firstCourt;
    private UUID secondCourt;
    private UUID janeAccountId;
    private UUID janePersonId;
    private UUID johnAccountId;
    private UUID johnPersonId;

    @BeforeEach
    void aClubWithTwoCourts() {
        firstCourt = facility.createCourt(1, "Court 1");
        secondCourt = facility.createCourt(2, "Court 2");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        janePersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccountId = identity.createEnabledAccount(janePersonId, "doe.jane", Set.of(Role.MEMBER));
        johnPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        johnAccountId = identity.createEnabledAccount(johnPersonId, "roe.john", Set.of(Role.MEMBER));
    }

    @Test
    void givenSomebodyElsesBooking_whenItsIdIsUsedAsAPersonalCursor_thenThePageIsEmpty() {
        // given
        UUID ownEarlier = bookedByJane(firstCourt, TWO_PM, THREE_PM);
        UUID somebodyElses = bookedByJohn(secondCourt, SIX_PM, SEVEN_PM);

        // when
        List<UUID> page = personalPageFor(janeAccountId, somebodyElses);

        // then
        assertThat(page)
                .as("the cursor names a booking this account does not hold, so it resolves against"
                        + " nothing and the page ends rather than disclosing where %s sits in time",
                        somebodyElses)
                .isEmpty();
        assertThat(personalPageFor(janeAccountId, null))
                .as("the account's own list is untouched by the refused cursor")
                .containsExactly(ownEarlier);
    }

    @Test
    void givenTwoOwnBookingsStartingTogether_whenPagingAcrossTheTie_thenEachIsWalkedExactlyOnce() {
        // given
        List<UUID> together = List.of(
                bookedByJane(firstCourt, SIX_PM, SEVEN_PM),
                bookedByJane(secondCourt, SIX_PM, SEVEN_PM));
        UUID sortsAfter = lastInPageOrder(together);
        UUID sortsBefore = otherThan(together, sortsAfter);

        // when
        List<UUID> firstPage = personalPageOfOne(null);
        List<UUID> secondPage = personalPageOfOne(sortsAfter);

        // then
        assertThat(firstPage)
                .as("a tie is broken by the id, and the page of one must land on the same side of"
                        + " it that the cursor then continues from")
                .containsExactly(sortsAfter);
        assertThat(secondPage).containsExactly(sortsBefore);
        assertThat(personalPageOfOne(sortsBefore))
                .as("the walk ends after the second of the pair rather than repeating it")
                .isEmpty();
    }

    @Test
    void givenABookingTheyWithdrewFrom_whenItsIdIsUsedAsAParticipationCursor_thenThePageIsEmpty() {
        // given
        UUID stillNamed = bookedByJaneNaming(johnPersonId, firstCourt, TWO_PM, THREE_PM);
        UUID leftBehind = bookedByJaneNaming(johnPersonId, secondCourt, SIX_PM, SEVEN_PM);
        participations.withdraw(leftBehind, johnPersonId, johnAccountId);

        // when
        List<UUID> page = participationPageFor(leftBehind);

        // then
        assertThat(page)
                .as("a member who withdrew keeps the id, so it is the one cursor they can offer"
                        + " that names a booking they may no longer see")
                .isEmpty();
        assertThat(participationPageFor(null))
                .as("what they may still see is unaffected")
                .containsExactly(stillNamed);
    }

    @Test
    void givenTwoParticipationsStartingTogether_whenTheCursorNamesTheOneTheyLeft_thenThePageIsEmpty() {
        // given
        List<UUID> together = List.of(
                bookedByJaneNaming(johnPersonId, firstCourt, SIX_PM, SEVEN_PM),
                bookedByJaneNaming(johnPersonId, secondCourt, SIX_PM, SEVEN_PM));
        UUID sortsAfter = lastInPageOrder(together);
        UUID sortsBefore = otherThan(together, sortsAfter);
        participations.withdraw(sortsAfter, johnPersonId, johnAccountId);

        // when
        List<UUID> page = participationPageFor(sortsAfter);

        // then
        assertThat(participationPageFor(null))
                .as("the booking that decides the case has to be in the list, or an empty page"
                        + " would prove nothing")
                .containsExactly(sortsBefore);
        assertThat(page)
                .as("both start at the same moment, so the id decides — and the cursor names the"
                        + " one that sorts after %s, which an unguarded clause would page past",
                        sortsBefore)
                .isEmpty();
    }

    @Test
    void givenTheBookingTheyMadeThemselves_whenItsIdIsUsedAsAParticipationCursor_thenThePageIsEmpty() {
        // given
        UUID namedByJohn = bookedByJohnNaming(janePersonId, firstCourt, TWO_PM, THREE_PM);
        UUID janesOwn = bookedByJaneNaming(johnPersonId, secondCourt, SIX_PM, SEVEN_PM);

        // when
        List<UUID> page = participationPageFor(janePersonId, janeAccountId, janesOwn);

        // then
        assertThat(page)
                .as("a booking one made oneself is excluded from one's participations, so its id is"
                        + " outside this list even though the account holds it")
                .isEmpty();
        assertThat(participationPageFor(janePersonId, janeAccountId, null))
                .containsExactly(namedByJohn);
    }

    @Test
    void givenACardTheirRoleNoLongerManages_whenItsBookingIsUsedAsAManagedCursor_thenThePageIsEmpty() {
        // given
        BookingCard stillManaged = trainerCard("Fitness session");
        BookingCard handedOver = trainerCard("Youth practice");
        UUID visible = bookedOnCard(stillManaged, firstCourt, TWO_PM, THREE_PM);
        UUID withdrawnFromView = bookedOnCard(handedOver, secondCourt, SIX_PM, SEVEN_PM);
        managedByNobody(handedOver);

        // when
        List<UUID> page = managedPageFor(withdrawnFromView);

        // then
        assertThat(page)
                .as("the board moved the card out of this role's reach, and a cursor the role"
                        + " collected while it still managed the card must not outlive that")
                .isEmpty();
        assertThat(managedPageFor(null))
                .as("what the role still manages is unaffected")
                .containsExactly(visible);
    }

    @Test
    void givenTwoManagedAppointmentsStartingTogether_whenTheCursorNamesTheHandedOverOne_thenThePageIsEmpty() {
        // given
        Map<UUID, BookingCard> byBooking = new LinkedHashMap<>();
        for (String label : List.of("Fitness session", "Youth practice")) {
            BookingCard card = trainerCard(label);
            byBooking.put(bookedOnCard(card, courtFor(byBooking.size()), SIX_PM, SEVEN_PM), card);
        }
        UUID sortsAfter = lastInPageOrder(byBooking.keySet());
        UUID sortsBefore = otherThan(byBooking.keySet(), sortsAfter);
        managedByNobody(byBooking.get(sortsAfter));

        // when
        List<UUID> page = managedPageFor(sortsAfter);

        // then
        assertThat(managedPageFor(null))
                .as("the appointment that decides the case has to be in the list, or an empty page"
                        + " would prove nothing")
                .containsExactly(sortsBefore);
        assertThat(page)
                .as("both start at the same moment, so the id decides — and the cursor names the"
                        + " one that sorts after %s", sortsBefore)
                .isEmpty();
    }

    @Test
    void givenAnAdministrator_whenTheCursorNamesAnAppointmentNoRoleManages_thenPagingContinues() {
        // given
        BookingCard unmanaged = cards.createCard("Court maintenance", "#34584A",
                Set.of(Role.TRAINER), Set.of(), new short[] { }, false, true, true);
        UUID earlier = bookedOnCard(unmanaged, firstCourt, TWO_PM, THREE_PM);
        UUID cursor = bookedOnCard(unmanaged, secondCourt, SIX_PM, SEVEN_PM);

        // when
        List<UUID> page = idsOf(managed.list(Set.of(Role.ADMIN), cursor, PAGE_LIMIT).bookings());

        // then
        assertThat(page)
                .as("an administrator sees every appointment, so no cursor is outside their"
                        + " visibility and the page after it must still be served")
                .containsExactly(earlier);
    }

    @Test
    void givenACancelledBookingBetweenTwoPages_whenPagingAcrossIt_thenItIsStillTheCursorThatWorks() {
        // given
        UUID earliest = bookedByJane(firstCourt, TWO_PM, THREE_PM);
        UUID cancelled = bookedByJane(secondCourt, SIX_PM, SEVEN_PM);
        bookings.cancel(cancelled, janeAccountId, Set.of(Role.MEMBER));

        // when
        PersonalBookingPage first = bookings.personalBookings(janeAccountId, null, 1);
        List<UUID> firstPage = idsOf(first.bookings());
        UUID cursor = first.nextCursor();

        // then
        assertThat(firstPage)
                .as("a booking is cancelled and never removed, so it still holds its place in the"
                        + " list and still hands out a usable cursor")
                .containsExactly(cancelled);
        assertThat(cursor).isEqualTo(cancelled);
        assertThat(personalPageFor(janeAccountId, cursor)).containsExactly(earliest);
    }

    @Test
    void givenSeveralManagedAppointments_whenTheyArePagedOneAtATime_thenEachIsWalkedExactlyOnce() {
        // given
        BookingCard card = trainerCard("Fitness session");
        UUID earlier = bookedOnCard(card, firstCourt, TWO_PM, THREE_PM);
        UUID onOneCourt = bookedOnCard(card, firstCourt, SIX_PM, SEVEN_PM);
        UUID onTheOther = bookedOnCard(card, secondCourt, SIX_PM, SEVEN_PM);

        // when
        List<UUID> walked = new ArrayList<>();
        UUID cursor = null;
        for (int page = 0; page < 3; page += 1) {
            ManagedAppointmentQuery.Page current = managed.list(Set.of(Role.TRAINER), cursor, 1);
            walked.addAll(idsOf(current.bookings()));
            cursor = current.nextCursor();
        }

        // then
        assertThat(walked).containsExactlyInAnyOrder(earlier, onOneCourt, onTheOther);
        assertThat(walked.getLast()).isEqualTo(earlier);
        assertThat(cursor).isNull();
    }

    // Java orders a uuid by two signed longs, Postgres by sixteen unsigned bytes, and the two
    // disagree on roughly half of all pairs — the page order is the database's.
    private static UUID lastInPageOrder(Collection<UUID> candidates) {
        return candidates.stream().max(Comparator.comparing(UUID::toString)).orElseThrow();
    }

    private static UUID otherThan(Collection<UUID> candidates, UUID excluded) {
        return candidates.stream().filter(candidate -> !candidate.equals(excluded))
                .reduce((only, second) -> {
                    throw new IllegalStateException("expected exactly one other booking");
                }).orElseThrow();
    }

    private UUID courtFor(int index) {
        return index == 0 ? firstCourt : secondCourt;
    }

    private List<UUID> personalPageOfOne(UUID cursor) {
        return idsOf(bookings.personalBookings(janeAccountId, cursor, 1).bookings());
    }

    private List<UUID> personalPageFor(UUID accountId, UUID cursor) {
        return idsOf(bookings.personalBookings(accountId, cursor, PAGE_LIMIT).bookings());
    }

    private List<UUID> participationPageFor(UUID cursor) {
        return participationPageFor(johnPersonId, johnAccountId, cursor);
    }

    private List<UUID> participationPageFor(UUID personId, UUID accountId, UUID cursor) {
        return idsOf(participations.participations(personId, accountId, cursor, PAGE_LIMIT).bookings());
    }

    private List<UUID> managedPageFor(UUID cursor) {
        return idsOf(managed.list(Set.of(Role.TRAINER), cursor, PAGE_LIMIT).bookings());
    }

    private static List<UUID> idsOf(List<Booking> found) {
        return found.stream().map(Booking::getId).toList();
    }

    private BookingCard trainerCard(String label) {
        return cards.createCard(label, "#34584A", Set.of(Role.TRAINER), Set.of(Role.TRAINER),
                new short[] { }, false, true, true);
    }

    private void managedByNobody(BookingCard card) {
        changeManagingRoles(card, Set.of());
    }

    private void changeManagingRoles(BookingCard card, Set<Role> managingRoles) {
        cards.changeCard(card.getId(), card.getLabel(), card.getColor(), card.getAllowedRoles(),
                managingRoles, card.getAllowedPlayerCounts(), card.isCountsAgainstLimits(),
                card.isGuestAllowed(), card.isShowGenericOccupancy());
    }

    private UUID bookedOnCard(BookingCard card, UUID court, Instant from, Instant to) {
        return bookings.create(new CreateBookingCommand(List.of(court), card.getId(),
                new TimeSlot(from, to), UUID.randomUUID(), janePersonId, Set.of(Role.TRAINER),
                null, List.of(), null));
    }

    private UUID bookedByJane(UUID court, Instant from, Instant to) {
        return booked(janeAccountId, janePersonId, johnPersonId, court, from, to);
    }

    private UUID bookedByJohn(UUID court, Instant from, Instant to) {
        return booked(johnAccountId, johnPersonId, janePersonId, court, from, to);
    }

    private UUID bookedByJaneNaming(UUID participant, UUID court, Instant from, Instant to) {
        return booked(janeAccountId, janePersonId, participant, court, from, to);
    }

    private UUID bookedByJohnNaming(UUID participant, UUID court, Instant from, Instant to) {
        return booked(johnAccountId, johnPersonId, participant, court, from, to);
    }

    private UUID booked(UUID accountId, UUID personId, UUID participant,
                        UUID court, Instant from, Instant to) {
        List<ParticipantSpec> named = participant == null
                ? List.of() : List.of(ParticipantSpec.member(participant));
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_BOOKING_CARD,
                new TimeSlot(from, to), accountId, personId, Set.of(Role.MEMBER), null, named, null));
    }
}
