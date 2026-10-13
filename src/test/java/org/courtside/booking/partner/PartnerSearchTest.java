package org.courtside.booking.partner;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.ParticipantCard;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, MemberTestFixture.class,
        RulesTestFixture.class, CardTestFixture.class})
class PartnerSearchTest extends AbstractIntegrationTest {

    static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final UUID BALL_MACHINE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private PartnerSearchService partnerSearch;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingTestFixture bookingFixture;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture memberships;

    @Autowired
    private RulesTestFixture rulesFixture;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private Member holder;
    private Member seeker;

    record Member(UUID accountId, UUID personId, Set<Role> roles) {
    }

    @BeforeEach
    void aCourtAndTwoMembers() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holder = member("Jane", "Doe", Role.MEMBER);
        seeker = member("John", "Roe", Role.MEMBER);
    }

    @Test
    void givenABookingLookingForAPartner_whenItsHolderPublishesThePlace_thenAnotherMemberSeesOnlyTheSlot() {
        // given
        UUID booking = bookLookingForAPartner(holder);

        // when
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // then
        assertThat(openPlacesFor(seeker)).singleElement().satisfies(place -> {
            assertThat(place.invitationId()).isEqualTo(invitation);
            assertThat(place.slot()).isEqualTo(SLOT);
            assertThat(place.courtIds()).containsExactly(court);
            assertThat(place.cardId()).isEqualTo(MEMBER_CARD);
        });
        assertThat(openPlacesFor(holder)).as("the holder is not offered their own place").isEmpty();
    }

    @Test
    void givenAPublishedPlace_whenAMemberTakesIt_thenTheyTakeThePartnerSlotAndThePlaceIsGone() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());
        int markerPosition = positionOfTheMarker(booking);

        // when
        UUID joined = partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(), seeker.roles());

        // then
        assertThat(joined).isEqualTo(booking);
        assertThat(participantsOf(booking))
                .as("the marker's slot now holds the member, so the booking keeps its player count")
                .contains(Map.of("kind", "MEMBER", "position", markerPosition))
                .noneMatch(row -> "CARD".equals(row.get("kind")));
        assertThat(openPlacesFor(member("Mary", "Major", Role.MEMBER))).as("a filled place is offered to nobody")
                .isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .as("a place is taken once")
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    @Test
    void givenAPublishedPlace_whenItIsPublishedAgain_thenTheSameInvitationStands() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID first = partnerSearch.publish(booking, holder.accountId());

        // when
        UUID second = partnerSearch.publish(booking, holder.accountId());

        // then
        assertThat(second).isEqualTo(first);
        assertThat(openPlacesFor(seeker)).hasSize(1);
    }

    @Test
    void givenAPublishedPlace_whenTheHolderWithdrawsIt_thenNobodySeesOrTakesIt() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        partnerSearch.withdraw(booking, holder.accountId());

        // then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    @Test
    void givenABookingWithoutTheMarker_whenItsHolderPublishes_thenThereIsNoPlaceToOffer() {
        // given
        UUID booking = book(holder, MEMBER_CARD, List.of(ParticipantSpec.card(BALL_MACHINE)));

        // when / then
        assertThatThrownBy(() -> partnerSearch.publish(booking, holder.accountId()))
                .isInstanceOfSatisfying(PartnerPlaceUnavailableException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("partner.place.none"));
    }

    @Test
    void givenSomebodyElsesBooking_whenAMemberPublishesOrWithdrawsIt_thenTheBookingIsNotFound() {
        // given
        UUID booking = bookLookingForAPartner(holder);

        // when / then
        assertThatThrownBy(() -> partnerSearch.publish(booking, seeker.accountId()))
                .isInstanceOf(BookingNotFoundException.class);
        assertThatThrownBy(() -> partnerSearch.withdraw(booking, seeker.accountId()))
                .isInstanceOf(BookingNotFoundException.class);
    }

    @Test
    void givenACancelledBooking_whenItsPlaceWasPublished_thenNobodySeesOrTakesIt() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        bookingFixture.cancelBooking(booking, holder.accountId(), holder.roles());

        // then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
        assertThatThrownBy(() -> partnerSearch.publish(booking, holder.accountId()))
                .isInstanceOfSatisfying(PartnerPlaceUnavailableException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("partner.place.closed"));
    }

    @Test
    void givenAStartedBooking_whenItsPlaceWasPublished_thenNobodySeesOrTakesItAndTheSweepRemovesIt() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        startedAnHourAgo(booking);

        // then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
        partnerSearch.sweep();
        assertThat(jdbc.sql("SELECT count(*) FROM partner_invitation").query(Integer.class).single())
                .as("an invitation nobody can take any more is removed").isZero();
    }

    @Test
    void givenACardTheAccountMayNotBook_whenItsPlaceIsPublished_thenItNeitherSeesNorTakesIt() {
        // given
        Member trainer = member("Richard", "Miles", Role.TRAINER);
        UUID squadCard = cards.createBookingCard("Squad doubles", Set.of(Role.TRAINER), Set.of(), (short) 2);
        UUID booking = book(trainer, squadCard, List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)));
        UUID invitation = partnerSearch.publish(booking, trainer.accountId());

        // when / then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    @Test
    void givenAMemberBarredFromBooking_whenAPlaceIsPublished_thenTheyNeitherSeeNorTakeIt() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());
        UUID barred = memberships.membershipTypeMeasuredBy("Youth", rulesFixture.ruleSetBarringCourtBookings("Youth"));
        memberships.assignMembership(seeker.personId(), barred, LocalDate.of(2026, 1, 1));

        // when / then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    @Test
    void givenADisabledAccount_whenItTriesToTakeAPlace_thenThePlaceIsNotFound() {
        // given
        UUID booking = bookLookingForAPartner(holder);
        UUID invitation = partnerSearch.publish(booking, holder.accountId());
        identity.disableAccount(seeker.accountId());

        // when / then
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    @Test
    void givenAMemberAlreadyPlaying_whenAPlaceInTheSameBookingIsPublished_thenTheyAreNotOfferedIt() {
        // given
        UUID booking = book(holder, MEMBER_CARD, List.of(ParticipantSpec.member(seeker.personId()),
                ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER), ParticipantSpec.guest("Partner")));
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when / then
        assertThat(openPlacesFor(seeker)).isEmpty();
        assertThatThrownBy(() -> partnerSearch.accept(invitation, seeker.accountId(), seeker.personId(),
                seeker.roles()))
                .isInstanceOf(PartnerInvitationNotFoundException.class);
    }

    private List<PartnerSearchService.OpenPlace> openPlacesFor(Member member) {
        return partnerSearch.openPlaces(member.accountId(), member.personId(), member.roles());
    }

    private UUID bookLookingForAPartner(Member member) {
        return book(member, MEMBER_CARD, List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)));
    }

    private UUID book(Member member, UUID cardId, List<ParticipantSpec> participants) {
        return bookings.create(new CreateBookingCommand(List.of(court), cardId, SLOT, member.accountId(),
                member.personId(), member.roles(), null, participants, null));
    }

    private int positionOfTheMarker(UUID booking) {
        return jdbc.sql("SELECT position FROM booking_participant WHERE booking_id = :booking AND card_id = :card")
                .param("booking", booking).param("card", ParticipantCard.LOOKING_FOR_A_PARTNER)
                .query(Integer.class).single();
    }

    private List<Map<String, Object>> participantsOf(UUID booking) {
        return jdbc.sql("""
                        SELECT kind, position FROM booking_participant WHERE booking_id = :booking
                        """)
                .param("booking", booking).query().listOfRows();
    }

    private void startedAnHourAgo(UUID booking) {
        jdbc.sql("""
                        UPDATE court_allocation SET starts_at = TIMESTAMPTZ '2026-05-12T09:00:00Z',
                                                    ends_at = TIMESTAMPTZ '2026-05-12T10:30:00Z'
                        WHERE booking_id = :booking
                        """)
                .param("booking", booking).update();
    }

    private Member member(String firstName, String lastName, Role role) {
        UUID person = identity.createPerson(firstName, lastName,
                (firstName + "." + lastName).toLowerCase() + "@example.org");
        Set<Role> roles = Set.of(role);
        return new Member(identity.createEnabledAccount(person, (lastName + "." + firstName).toLowerCase(), roles),
                person, roles);
    }
}
