package org.courtside.booking.partner;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.ParticipantCard;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class})
class PartnerSearchConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private PartnerSearchService partnerSearch;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private BookingTestFixture bookingFixture;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private Member holder;
    private Member first;
    private Member second;

    record Member(UUID accountId, UUID personId) {
    }

    @BeforeEach
    void aCourtAndThreeMembers() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holder = member("Jane", "Doe");
        first = member("John", "Roe");
        second = member("Mary", "Major");
    }

    @RepeatedTest(5)
    void givenOnePublishedPlace_whenTwoMembersTakeItAtOnce_thenExactlyOneOfThemPlays() throws Exception {
        // given
        UUID booking = bookLookingForAPartner(List.of());
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        List<Boolean> outcomes = race(() -> took(invitation, first), () -> took(invitation, second));

        // then
        assertThat(outcomes).as("one member takes the place, the other finds it gone")
                .containsExactlyInAnyOrder(true, false);
        assertThat(membersIn(booking)).as("the booking keeps exactly one partner").hasSize(1);
    }

    @RepeatedTest(5)
    void givenOnePublishedPlace_whenTheHolderCancelsWhileAMemberTakesIt_thenNobodyPlaysInACancelledBooking()
            throws Exception {
        // given
        UUID booking = bookLookingForAPartner(List.of());
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        List<Boolean> outcomes = race(() -> took(invitation, first), () -> {
            bookingFixture.cancelBooking(booking, holder.accountId(), Set.of(Role.MEMBER));
            return true;
        });

        // then
        boolean joined = outcomes.getFirst();
        assertThat(bookingFixture.isConfirmed(booking)).as("the cancellation stands either way").isFalse();
        assertThat(membersIn(booking)).as("a member joins only a booking that still stood when they took it")
                .hasSize(joined ? 1 : 0);
    }

    @RepeatedTest(5)
    void givenAPlayerWithdrawingWhileAMemberTakesThePlace_whenBothFinish_thenBothChangesStand() throws Exception {
        // given
        UUID booking = bookLookingForAPartner(List.of(ParticipantSpec.member(second.personId()), ParticipantSpec.guest("Partner")));
        UUID invitation = partnerSearch.publish(booking, holder.accountId());

        // when
        List<Boolean> outcomes = race(() -> took(invitation, first), () -> {
            participations.withdraw(booking, second.personId(), second.accountId());
            return true;
        });

        // then
        assertThat(outcomes).containsExactly(true, true);
        assertThat(membersIn(booking)).as("the new partner plays and the one who withdrew does not")
                .containsExactly(first.personId());
    }

    private boolean took(UUID invitation, Member member) {
        try {
            partnerSearch.accept(invitation, member.accountId(), member.personId(), Set.of(Role.MEMBER));
            return true;
        } catch (PartnerInvitationNotFoundException gone) {
            return false;
        }
    }

    private UUID bookLookingForAPartner(List<ParticipantSpec> others) {
        List<ParticipantSpec> participants = new ArrayList<>(others);
        participants.add(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER));
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT, holder.accountId(),
                holder.personId(), Set.of(Role.MEMBER), null, participants, null));
    }

    private List<UUID> membersIn(UUID booking) {
        return jdbc.sql("""
                        SELECT person_id FROM booking_participant
                        WHERE booking_id = :booking AND kind = 'MEMBER' AND person_id <> :holder
                        """)
                .param("booking", booking).param("holder", holder.personId()).query(UUID.class).list();
    }

    @SafeVarargs
    private List<Boolean> race(Callable<Boolean>... calls) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<Boolean> outcomes = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(calls.length)) {
            List<Future<Boolean>> running = java.util.Arrays.stream(calls).<Callable<Boolean>>map(call -> () -> {
                start.await();
                return call.call();
            }).map(pool::submit).toList();
            start.countDown();
            for (Future<Boolean> future : running) {
                outcomes.add(PostgresDiagnostics.await(future, Duration.ofSeconds(40), jdbc, "Racing call"));
            }
        }
        return outcomes;
    }

    private Member member(String firstName, String lastName) {
        UUID person = identity.createPerson(firstName, lastName,
                (firstName + "." + lastName).toLowerCase() + "@example.org");
        return new Member(identity.createEnabledAccount(person, (lastName + "." + firstName).toLowerCase(),
                Set.of(Role.MEMBER)), person);
    }
}
