package org.courtside.booking.waitlist;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.internal.CourtReservedException;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesMoveConflictException;
import org.courtside.booking.series.SeriesPreview;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.SecurityEventLog;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, ConfigTestFixture.class, BookingTestFixture.class,
        MemberTestFixture.class, RulesTestFixture.class})
class WaitlistTest extends AbstractIntegrationTest {

    static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    static final UUID COURT_CLOSED = UUID.fromString("44444444-4444-4444-4444-444444444444");
    static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private WaitlistService waitlist;

    @Autowired
    private WaitlistQueue queue;

    @Autowired
    private BookingService bookings;

    @Autowired
    private SeriesService series;

    @Autowired
    private BookingTestFixture bookingFixture;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ConfigTestFixture configuration;

    @Autowired
    private RulesTestFixture rulesFixture;

    @Autowired
    private MemberTestFixture memberships;

    @MockitoSpyBean
    private SecurityEventLog securityEvents;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private Member holder;
    private Member first;
    private Member second;
    private Member partner;

    record Member(UUID accountId, UUID personId) {
    }

    @BeforeEach
    void aCourtHeldByOneMember() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        holder = member("Jane", "Doe", Role.MEMBER);
        first = member("John", "Roe", Role.MEMBER);
        second = member("Mary", "Major", Role.MEMBER);
        partner = member("Richard", "Miles", Role.MEMBER);
    }

    @Test
    void givenATakenSlot_whenAMemberJoins_thenTheEntryWaitsWithoutAnOffer() {
        // given
        book(holder, SLOT);

        // when
        UUID entry = join(first, SLOT);

        // then
        assertThat(stateOf(entry)).as("a slot that is still taken offers nothing").isEqualTo("WAITING");
        assertThat(waitlist.ownEntries(first.accountId())).singleElement()
                .satisfies(own -> assertThat(own.id()).isEqualTo(entry))
                .satisfies(own -> assertThat(own.offerExpiresAt()).isNull());
    }

    @Test
    void givenAFreeSlot_whenAMemberJoins_thenTheQueueIsRefusedAsNotTaken() {
        // when / then
        assertThatThrownBy(() -> join(first, SLOT))
                .isInstanceOfSatisfying(WaitlistSlotNotTakenException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.slot.free"));
        assertThat(entries()).as("a refused join stores nothing").isZero();
    }

    @Test
    void givenTheMembersOwnBooking_whenTheyJoin_thenTheQueueIsRefusedAsTheirOwn() {
        // given
        book(first, SLOT);

        // when / then
        assertThatThrownBy(() -> join(first, SLOT))
                .isInstanceOfSatisfying(WaitlistSlotNotTakenException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.slot.own"));
    }

    @Test
    void givenAnOpenEntry_whenTheMemberJoinsTheSameSlotAgain_thenTheDatabaseRefusesASecondOne() {
        // given
        book(holder, SLOT);
        join(first, SLOT);

        // when / then
        assertThatThrownBy(() -> join(first, SLOT))
                .isInstanceOfSatisfying(WaitlistEntryExistsException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.exists"));
        assertThat(entries()).isEqualTo(1);
    }

    @Test
    void givenAnOpenEntry_whenTheMemberJoinsAnOverlappingTimeOnTheSameCourt_thenItIsRefusedAsTheSameWait() {
        // given
        book(holder, SLOT);
        join(first, SLOT);
        TimeSlot overlapping = new TimeSlot(SLOT.start().plus(30, ChronoUnit.MINUTES),
                SLOT.end().plus(30, ChronoUnit.MINUTES));

        // when / then
        assertThatThrownBy(() -> join(first, overlapping))
                .as("one account cannot stack offer windows over one court and time")
                .isInstanceOfSatisfying(WaitlistEntryExistsException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.exists"));
        assertThat(entries()).isEqualTo(1);
    }

    @Test
    void givenASlotOutsideTheOpeningHours_whenAMemberJoins_thenTheBookingRuleRefusesIt() {
        // given
        TimeSlot late = new TimeSlot(Instant.parse("2026-05-13T21:00:00Z"), Instant.parse("2026-05-13T22:00:00Z"));

        // when / then
        assertThatThrownBy(() -> join(first, late))
                .isInstanceOfSatisfying(BookingRulesViolatedException.class, failure ->
                        assertThat(failure.violationCodes()).contains("booking.rule.openingHours.outside"));
        assertThat(entries()).isZero();
    }

    @Test
    void givenAMemberAtTheEntryLimit_whenTheyJoinOnceMore_thenTheLimitRefusesIt() {
        // given
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            TimeSlot slot = shifted(SLOT, day);
            book(holder, slot);
            join(first, slot);
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatThrownBy(() -> join(first, oneMore))
                .isInstanceOfSatisfying(WaitlistLimitReachedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.limit"));
    }

    @Test
    void givenAMemberWhoLeftAsManyWaitlistsAsTheLimit_whenTheyJoinAnother_thenTheLimitRefusesIt() {
        // given
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            TimeSlot slot = shifted(SLOT, day);
            book(holder, slot);
            waitlist.leave(join(first, slot), first.accountId());
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatThrownBy(() -> join(first, oneMore))
                .as("joining and leaving in turn cannot get round the limit")
                .isInstanceOfSatisfying(WaitlistLimitReachedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.limit"));
    }

    @Test
    void givenAMemberWhoTookAndCancelledAsManyOffersAsTheLimit_whenTheyJoinAnother_thenTheLimitRefusesIt() {
        // given
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            TimeSlot slot = shifted(SLOT, day);
            UUID held = book(holder, slot);
            UUID entry = join(first, slot);
            bookings.cancel(held, holder.accountId(), Set.of(Role.MEMBER));
            UUID taken = waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER));
            bookings.cancel(taken, first.accountId(), Set.of(Role.MEMBER));
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatThrownBy(() -> join(first, oneMore))
                .as("taking an offer and cancelling its booking cannot get round the limit")
                .isInstanceOfSatisfying(WaitlistLimitReachedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.limit"));
    }

    @Test
    void givenAsManyBookedEntriesAsTheLimitWhoseBookingMovedAway_whenTheMemberJoinsAnother_thenTheLimitRefusesIt() {
        // given
        UUID elsewhere = book(first, shifted(SLOT, WaitlistService.MAX_ENTRIES + 1));
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            insertClosed(first, shifted(SLOT, day), "BOOKED", elsewhere);
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatThrownBy(() -> join(first, oneMore))
                .as("a booking that no longer holds the entry's court and time frees no place")
                .isInstanceOfSatisfying(WaitlistLimitReachedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.limit"));
    }

    @Test
    void givenAsManyWithdrawnEntriesAsTheLimit_whenTheMemberJoinsAnother_thenTheLimitRefusesIt() {
        // given
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            insertClosed(first, shifted(SLOT, day), "WITHDRAWN", null);
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatThrownBy(() -> join(first, oneMore))
                .as("withdrawn entries count until their slot ends")
                .isInstanceOfSatisfying(WaitlistLimitReachedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.limit"));
    }

    @Test
    void givenAMemberWhoTookAsManyOffersAsTheLimit_whenTheyJoinAnother_thenTheEntryIsTaken() {
        // given
        for (int day = 0; day < WaitlistService.MAX_ENTRIES; day++) {
            TimeSlot slot = shifted(SLOT, day);
            UUID held = book(holder, slot);
            UUID entry = join(first, slot);
            bookings.cancel(held, holder.accountId(), Set.of(Role.MEMBER));
            waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER));
        }
        TimeSlot oneMore = shifted(SLOT, WaitlistService.MAX_ENTRIES);
        book(holder, oneMore);

        // when / then
        assertThatCode(() -> join(first, oneMore))
                .as("an entry that became a booking leaves room under the limit")
                .doesNotThrowAnyException();
        assertThat(waitlist.ownEntries(first.accountId()))
                .filteredOn(own -> own.state() == WaitlistState.WAITING)
                .extracting(WaitlistEntry::slot).containsExactly(oneMore);
    }

    @Test
    void givenTwoMembersWaiting_whenTheHolderCancels_thenOnlyTheFirstIsOfferedTheSlotForTheWindow() {
        // given
        configuration.holdWaitlistOffersFor(20);
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(firstEntry)).isEqualTo("OFFERED");
        assertThat(stateOf(secondEntry)).as("the second waits behind the first").isEqualTo("WAITING");
        assertThat(expiryOf(firstEntry)).isEqualTo(NOW.plus(20, ChronoUnit.MINUTES));
    }

    @Test
    void givenAWindowReachingPastTheStart_whenTheSlotFrees_thenTheOfferEndsAtTheStart() {
        // given
        configuration.holdWaitlistOffersFor(120);
        TimeSlot soon = new TimeSlot(Instant.parse("2026-05-12T10:30:00Z"), Instant.parse("2026-05-12T11:30:00Z"));
        UUID booking = book(holder, soon);
        UUID entry = join(first, soon);

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(expiryOf(entry)).isEqualTo(soon.start());
    }

    @Test
    void givenAnOffer_whenSomebodyElseBooksTheSlot_thenTheCourtIsReservedForTheOfferedMember() {
        // given
        offerTo(first);

        // when / then
        assertThatThrownBy(() -> book(second, SLOT)).isInstanceOf(CourtReservedException.class)
                .extracting(failure -> ((CourtReservedException) failure).problemType().slug())
                .isEqualTo("court-reserved");
        assertThat(confirmedOnCourt()).as("nobody holds the court while it is reserved").isZero();
    }

    @Test
    void givenAnOffer_whenTheMemberAccepts_thenTheReservationBecomesTheirBookingOnce() {
        // given
        UUID entry = offerTo(first);

        // when
        UUID booking = waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER));
        UUID again = waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER));

        // then
        assertThat(again).as("accepting again answers with the same booking").isEqualTo(booking);
        assertThat(stateOf(entry)).isEqualTo("BOOKED");
        assertThat(jdbc.sql("SELECT booked_by FROM booking WHERE id = :id AND status = 'CONFIRMED'")
                .param("id", booking).query(UUID.class).single()).isEqualTo(first.accountId());
        assertThat(jdbc.sql("SELECT person_id FROM booking_participant WHERE booking_id = :id ORDER BY position")
                .param("id", booking).query(UUID.class).list())
                .as("the players named on joining play in the booking")
                .containsExactly(first.personId(), partner.personId());
        assertThat(confirmedOnCourt()).isEqualTo(1);
    }

    @Test
    void givenAWeekFilledAfterJoining_whenTheSlotFrees_thenTheMemberIsSkippedAndCannotTakeIt() {
        // given
        configuration.bindPeopleWithoutAMembershipTypeTo(rulesFixture.ruleSetLimitingWeeklyHours("An hour a week", 1));
        UUID held = book(holder, SLOT);
        UUID entry = join(first, SLOT);
        book(first, shifted(SLOT, 1));

        // when
        bookings.cancel(held, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(entry)).as("a member past the weekly limit is not offered the slot").isEqualTo("SKIPPED");
        assertThatThrownBy(() -> waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER)))
                .isInstanceOf(WaitlistNoOfferException.class);
    }

    @Test
    void givenAnAcceptedOfferWhoseBookingWasCancelled_whenTheMemberAcceptsAgain_thenThereIsNoOfferToTake() {
        // given
        UUID entry = offerTo(first);
        UUID booking = waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER));
        bookings.cancel(booking, first.accountId(), Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER)))
                .as("a cancelled booking is not handed back as the answer to an acceptance")
                .isInstanceOfSatisfying(WaitlistNoOfferException.class, failure ->
                        assertThat(failure.problemType().slug()).isEqualTo("waitlist-no-offer"));
    }

    @Test
    void givenAnOffer_whenTheMemberBooksTheSlotThemselves_thenTheirEntryClosesAsBooked() {
        // given
        UUID entry = offerTo(first);

        // when
        UUID booking = book(first, SLOT);

        // then
        assertThat(stateOf(entry)).isEqualTo("BOOKED");
        assertThat(jdbc.sql("SELECT booking_id FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(UUID.class).single()).isEqualTo(booking);
    }

    @Test
    void givenAnOffer_whenAnotherMemberAcceptsIt_thenTheEntryIsNotFoundForThem() {
        // given
        UUID entry = offerTo(first);

        // when / then
        assertThatThrownBy(() -> waitlist.accept(entry, second.accountId(), second.personId(), Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(WaitlistEntryNotFoundException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.entry.notFound"));
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
    }

    @Test
    void givenAWaitingEntry_whenTheMemberAccepts_thenThereIsNoOfferToTake() {
        // given
        book(holder, SLOT);
        UUID entry = join(first, SLOT);

        // when / then
        assertThatThrownBy(() -> waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(WaitlistNoOfferException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("waitlist.offer.none"));
    }

    @Test
    void givenAnOfferPastItsDeadline_whenTheMemberAccepts_thenItIsRefusedAndReadsAsExpired() {
        // given
        UUID entry = offerTo(first);
        jdbc.sql("UPDATE waitlist_entry SET offer_expires_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(NOW)).param("id", entry).update();

        // when / then
        assertThatThrownBy(() -> waitlist.accept(entry, first.accountId(), first.personId(), Set.of(Role.MEMBER)))
                .isInstanceOf(WaitlistNoOfferException.class);
        assertThat(waitlist.ownEntries(first.accountId())).singleElement()
                .satisfies(own -> assertThat(own.state()).isEqualTo(WaitlistState.EXPIRED));
        assertThat(confirmedOnCourt()).isZero();
    }

    @Test
    void givenAnOffer_whenTheMemberDeclines_thenTheNextMemberIsOfferedTheSlot() {
        // given
        UUID firstEntry = offerTo(first);
        UUID secondEntry = jdbc.sql("SELECT id FROM waitlist_entry WHERE account_id = :account")
                .param("account", second.accountId()).query(UUID.class).single();

        // when
        waitlist.leave(firstEntry, first.accountId());

        // then
        assertThat(stateOf(firstEntry)).isEqualTo("LEFT");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenAnOfferThatRanOut_whenTheSweepRuns_thenItExpiresAndTheNextMemberIsOffered() {
        // given
        UUID firstEntry = offerTo(first);
        UUID secondEntry = jdbc.sql("SELECT id FROM waitlist_entry WHERE account_id = :account")
                .param("account", second.accountId()).query(UUID.class).single();
        jdbc.sql("UPDATE waitlist_entry SET offer_expires_at = :at WHERE id = :id")
                .param("at", java.sql.Timestamp.from(NOW)).param("id", firstEntry).update();

        // when
        queue.sweep();

        // then
        assertThat(stateOf(firstEntry)).isEqualTo("EXPIRED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenTheFirstMemberAtTheirBookingLimit_whenTheSlotFrees_thenTheRuleSkipsThemForTheNext() {
        // given
        memberships.assignMembership(first.personId(), memberships.membershipTypeMeasuredBy("Standard",
                UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001")));
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);
        book(first, shifted(SLOT, 1));
        book(first, shifted(SLOT, 2));

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(firstEntry)).as("an offer passes the booking rules first").isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenAnOfferARuleRefusesToAccept_whenTheSweepRuns_thenItPassesToTheNextMember() {
        // given
        memberships.assignMembership(first.personId(), memberships.membershipTypeMeasuredBy("Standard",
                UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001")));
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        assertThat(stateOf(firstEntry)).isEqualTo("OFFERED");
        book(first, shifted(SLOT, 1));
        book(first, shifted(SLOT, 2));
        assertThatThrownBy(() -> waitlist.accept(firstEntry, first.accountId(), first.personId(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingRulesViolatedException.class);
        assertThat(stateOf(firstEntry)).as("a refused acceptance leaves the offer open").isEqualTo("OFFERED");

        // when
        queue.sweep();

        // then
        assertThat(stateOf(firstEntry)).as("the sweep passes on an offer its member still may not take")
                .isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenTheFirstMembersPlayersNoLongerAllowed_whenTheSlotFrees_thenTheyAreSkippedForTheNext() {
        // given
        UUID booking = book(holder, SLOT);
        UUID firstEntry = waitlist.join(new JoinWaitlistCommand(court, MEMBER_CARD, SLOT, first.accountId(),
                first.personId(), Set.of(Role.MEMBER), null, List.of(ParticipantSpec.guest("Guest"))));
        UUID secondEntry = join(second, SLOT);
        jdbc.sql("UPDATE booking_card SET guest_allowed = false WHERE id = :id").param("id", MEMBER_CARD).update();

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(firstEntry)).as("an offer passes the player checks of a booking").isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenTheCourtTakenOutOfService_whenTheSlotFrees_thenNobodyIsOfferedIt() {
        // given
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);
        facility.deactivateCourt(court);

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(List.of(stateOf(firstEntry), stateOf(secondEntry)))
                .as("a court nobody can book is offered to nobody").containsOnly("SKIPPED");
    }

    @Test
    void givenAnOfferWhoseMemberLosesTheCard_whenTheSweepRuns_thenTheOfferEndsAndPassesOn() {
        // given
        Member trainer = member("Jane", "Roe", Role.TRAINER);
        UUID booking = book(holder, SLOT);
        UUID trainerEntry = waitlist.join(new JoinWaitlistCommand(court, TRAINING_CARD, SLOT, trainer.accountId(),
                trainer.personId(), Set.of(Role.TRAINER), null, List.of()));
        UUID secondEntry = join(second, SLOT);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        assertThat(stateOf(trainerEntry)).isEqualTo("OFFERED");
        jdbc.sql("UPDATE booking_card SET active = false WHERE id = :id").param("id", TRAINING_CARD).update();

        // when
        queue.sweep();

        // then
        assertThat(stateOf(trainerEntry)).as("an offer its member may no longer take ends at once").isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenThreeMembersWaiting_whenEachOfferIsDeclinedInTurn_thenTheyAreOfferedInTheOrderTheyJoined() {
        // given
        Member third = member("Mary", "Doe", Role.MEMBER);
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);
        UUID thirdEntry = join(third, SLOT);
        List<UUID> offered = new java.util.ArrayList<>();

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        offered.add(offeredEntry());
        waitlist.leave(offered.getLast(), first.accountId());
        offered.add(offeredEntry());
        waitlist.leave(offered.getLast(), second.accountId());
        offered.add(offeredEntry());

        // then
        assertThat(offered).as("each decline passes the offer to the next in joining order")
                .containsExactly(firstEntry, secondEntry, thirdEntry);
    }

    @Test
    void givenAWaitingTrainerWhoLostTheRole_whenTheSlotFrees_thenTheyAreSkippedWithoutASecurityEvent() {
        // given
        Member trainer = member("Jane", "Roe", Role.TRAINER);
        UUID booking = book(holder, SLOT);
        UUID trainerEntry = waitlist.join(new JoinWaitlistCommand(court, TRAINING_CARD, SLOT, trainer.accountId(),
                trainer.personId(), Set.of(Role.TRAINER), null, List.of()));
        UUID secondEntry = join(second, SLOT);
        memberships.changeAccountRoles(trainer.personId(), Set.of(Role.MEMBER));

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(trainerEntry)).isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
        verify(securityEvents, never()).authorizationDeniedForCurrentAccount();
    }

    @Test
    void givenAnOffer_whenAFormerGroundskeeperMovesTheirClosureOntoTheReservedCourt_thenTheMoveIsBlocked() {
        // given
        UUID entry = offerTo(first);
        Member groundskeeper = member("Mary", "Roe", Role.GROUNDSKEEPER);
        UUID closure = bookingFixture.createSeries(court, COURT_CLOSED, LocalDate.of(2026, 5, 13),
                LocalTime.of(20, 0), 60, 1, groundskeeper.accountId(), groundskeeper.personId(),
                Set.of(Role.GROUNDSKEEPER));

        // when / then
        assertThatThrownBy(() -> bookingFixture.moveWholeSeries(closure, LocalTime.of(18, 0),
                groundskeeper.accountId(), Set.of(Role.MEMBER)))
                .as("a closure goes first only for whom the closure card admits")
                .isInstanceOf(SeriesMoveConflictException.class);
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
    }

    @Test
    void givenAnOffer_whenTheGroundskeeperMovesTheirClosureOntoTheReservedCourt_thenTheClosureTakesIt() {
        // given
        UUID entry = offerTo(first);
        Member groundskeeper = member("Mary", "Roe", Role.GROUNDSKEEPER);
        UUID closure = bookingFixture.createSeries(court, COURT_CLOSED, LocalDate.of(2026, 5, 13),
                LocalTime.of(20, 0), 60, 1, groundskeeper.accountId(), groundskeeper.personId(),
                Set.of(Role.GROUNDSKEEPER));

        // when
        bookingFixture.moveWholeSeries(closure, LocalTime.of(18, 0), groundskeeper.accountId(),
                Set.of(Role.GROUNDSKEEPER));

        // then
        assertThat(stateOf(entry)).isEqualTo("WITHDRAWN");
    }

    @Test
    void givenTheFirstMembersAccountDisabled_whenTheSlotFrees_thenTheyAreSkippedForTheNext() {
        // given
        UUID booking = book(holder, SLOT);
        UUID firstEntry = join(first, SLOT);
        UUID secondEntry = join(second, SLOT);
        identity.disableAccount(first.accountId());

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(firstEntry)).as("an account that cannot sign in cannot hold the court").isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenTheFirstMembersCardWithdrawn_whenTheSlotFrees_thenTheyAreSkippedForTheNext() {
        // given
        Member trainer = member("Jane", "Roe", Role.TRAINER);
        UUID booking = book(holder, SLOT);
        UUID trainerEntry = waitlist.join(new JoinWaitlistCommand(court, TRAINING_CARD, SLOT, trainer.accountId(),
                trainer.personId(), Set.of(Role.TRAINER), null, List.of()));
        UUID secondEntry = join(second, SLOT);
        jdbc.sql("UPDATE booking_card SET active = false WHERE id = :id").param("id", TRAINING_CARD).update();

        // when
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        assertThat(stateOf(trainerEntry)).as("a member no longer eligible is passed over").isEqualTo("SKIPPED");
        assertThat(stateOf(secondEntry)).isEqualTo("OFFERED");
    }

    @Test
    void givenWaitingEntries_whenTheSlotStartsAndEnds_thenTheSweepClosesAndThenForgetsThem() {
        // given
        TimeSlot started = new TimeSlot(NOW.minus(30, ChronoUnit.MINUTES), NOW.plus(30, ChronoUnit.MINUTES));
        TimeSlot ended = new TimeSlot(NOW.minus(90, ChronoUnit.MINUTES), NOW.minus(30, ChronoUnit.MINUTES));
        UUID startedEntry = insertWaiting(first, started);
        insertWaiting(second, ended);

        // when
        queue.sweep();

        // then
        assertThat(stateOf(startedEntry)).isEqualTo("ENDED");
        assertThat(entries()).as("an entry whose slot ended is removed").isEqualTo(1);
    }

    @Test
    void givenAnOffer_whenAnotherMemberReadsTheirEntriesOrTheReservations_thenNothingNamesTheOfferedMember() {
        // given
        UUID entry = offerTo(first);

        // when
        List<WaitlistService.Reservation> seenBySecond = waitlist.reservationsBetween(SLOT.start(), SLOT.end(),
                second.accountId());
        List<WaitlistService.Reservation> seenByFirst = waitlist.reservationsBetween(SLOT.start(), SLOT.end(),
                first.accountId());

        // then
        assertThat(seenBySecond).singleElement()
                .satisfies(reservation -> assertThat(reservation.ownEntryId()).isNull());
        assertThat(seenByFirst).singleElement()
                .satisfies(reservation -> assertThat(reservation.ownEntryId()).isEqualTo(entry));
        assertThat(waitlist.ownEntries(second.accountId())).singleElement()
                .satisfies(own -> assertThat(own.accountId()).isEqualTo(second.accountId()));
    }

    @Test
    void givenAnOffer_whenATrainerMovesASeriesOntoTheReservedCourt_thenTheMoveIsBlocked() {
        // given
        UUID entry = offerTo(first);
        Member trainer = member("Mary", "Roe", Role.TRAINER);
        UUID series = bookingFixture.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 13),
                LocalTime.of(20, 0), 60, 1, trainer.accountId(), trainer.personId(), Set.of(Role.TRAINER));

        // when / then
        assertThatThrownBy(() -> bookingFixture.moveWholeSeries(series, LocalTime.of(18, 0), trainer.accountId(),
                Set.of(Role.TRAINER))).isInstanceOf(SeriesMoveConflictException.class);
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
    }

    @Test
    void givenAnOffer_whenTheBoardMovesASeriesOntoTheReservedCourt_thenTheClubTakesItAndTheOfferIsWithdrawn() {
        // given
        UUID entry = offerTo(first);
        Member board = member("Mary", "Roe", Role.ADMIN);
        UUID series = bookingFixture.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 13),
                LocalTime.of(20, 0), 60, 1, board.accountId(), board.personId(), Set.of(Role.ADMIN));

        // when
        bookingFixture.moveWholeSeries(series, LocalTime.of(18, 0), board.accountId(), Set.of(Role.ADMIN));

        // then
        assertThat(stateOf(entry)).as("the board goes before a reservation").isEqualTo("WITHDRAWN");
        assertThat(confirmedOnCourt()).isEqualTo(1);
    }

    @Test
    void givenATrainersOwnOffer_whenTheyMoveTheirSeriesOntoIt_thenTheirEntryClosesAsBooked() {
        // given
        Member trainer = member("Mary", "Roe", Role.TRAINER);
        UUID booking = book(holder, SLOT);
        UUID entry = waitlist.join(new JoinWaitlistCommand(court, TRAINING_CARD, SLOT, trainer.accountId(),
                trainer.personId(), Set.of(Role.TRAINER), null, List.of()));
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        UUID series = bookingFixture.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 13),
                LocalTime.of(20, 0), 60, 1, trainer.accountId(), trainer.personId(), Set.of(Role.TRAINER));

        // when
        bookingFixture.moveWholeSeries(series, LocalTime.of(18, 0), trainer.accountId(), Set.of(Role.TRAINER));

        // then
        assertThat(stateOf(entry)).as("moving onto one's own reservation takes it").isEqualTo("BOOKED");
        assertThat(jdbc.sql("SELECT booking_id FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(UUID.class).single()).isEqualTo(bookingFixture.firstOccurrenceOf(series));
    }

    @Test
    void givenAnOffer_whenTheBoardBooksTheReservedCourt_thenTheClubTakesItAndTheOfferIsWithdrawn() {
        // given
        UUID entry = offerTo(first);
        Member board = member("Mary", "Roe", Role.ADMIN);

        // when
        bookings.create(new CreateBookingCommand(List.of(court), TRAINING_CARD, SLOT, board.accountId(),
                board.personId(), Set.of(Role.ADMIN), null, List.of(), null));

        // then
        assertThat(stateOf(entry)).as("the board goes before a reservation").isEqualTo("WITHDRAWN");
        assertThat(jdbc.sql("SELECT count(*) FROM waitlist_entry WHERE state = 'OFFERED'").query(Integer.class)
                .single()).as("a court the club took is offered to nobody else").isZero();
    }

    @Test
    void givenAnOffer_whenTheGroundskeeperClosesTheReservedCourt_thenTheClosureTakesItAndTheOfferIsWithdrawn() {
        // given
        UUID entry = offerTo(first);
        Member groundskeeper = member("Mary", "Roe", Role.GROUNDSKEEPER);

        // when
        bookings.create(new CreateBookingCommand(List.of(court), COURT_CLOSED, SLOT, groundskeeper.accountId(),
                groundskeeper.personId(), Set.of(Role.GROUNDSKEEPER), null, List.of(), null));

        // then
        assertThat(stateOf(entry)).as("a closure goes before a reservation").isEqualTo("WITHDRAWN");
    }

    @Test
    void givenAnOffer_whenATrainerPreviewsASeriesOverTheReservedCourt_thenThatDateShowsTheCourtTaken() {
        // given
        offerTo(first);
        Member trainer = member("Mary", "Roe", Role.TRAINER);
        Member board = member("John", "Major", Role.ADMIN);
        SeriesRule rule = new SeriesRule(List.of(court), TRAINING_CARD, LocalDate.of(2026, 5, 13), LocalTime.of(18, 0),
                60, 1, Set.of(DayOfWeek.WEDNESDAY), null, 2);

        // when
        SeriesPreview seenByTrainer = series.preview(rule, trainer.accountId(), trainer.personId(), Set.of(Role.TRAINER));
        SeriesPreview seenByBoard = series.preview(rule, board.accountId(), board.personId(), Set.of(Role.ADMIN));

        // then
        assertThat(seenByTrainer.occurrences()).extracting(occurrence -> occurrence.blockedCourtIds().isEmpty())
                .as("the preview skips what the creation would skip").containsExactly(false, true);
        assertThat(seenByBoard.occurrences()).extracting(occurrence -> occurrence.blockedCourtIds().isEmpty())
                .as("the board goes before a reservation").containsExactly(true, true);
    }

    @Test
    void givenAnOffer_whenATrainerCreatesASeriesOverTheReservedCourt_thenThatDateIsSkippedAndTheRestBooked() {
        // given
        offerTo(first);
        Member trainer = member("Mary", "Roe", Role.TRAINER);
        SeriesRule rule = new SeriesRule(List.of(court), TRAINING_CARD, LocalDate.of(2026, 5, 13), LocalTime.of(18, 0),
                60, 1, Set.of(DayOfWeek.WEDNESDAY), null, 2);
        List<Instant> starts = List.of(SLOT.start(), shifted(SLOT, 7).start());

        // when
        SeriesCreationResult result = series.create(rule, starts, trainer.accountId(), trainer.personId(),
                Set.of(Role.TRAINER), null);

        // then
        assertThat(result.skipped()).as("the reserved date is skipped like a taken one").containsExactly(SLOT.start());
        assertThat(result.bookingIds()).hasSize(1);
    }

    @Test
    void givenAnOffer_whenTheBoardCreatesASeriesOverTheReservedCourt_thenEveryDateIsBookedAndTheOfferWithdrawn() {
        // given
        UUID entry = offerTo(first);
        Member board = member("Mary", "Roe", Role.ADMIN);
        SeriesRule rule = new SeriesRule(List.of(court), TRAINING_CARD, LocalDate.of(2026, 5, 13), LocalTime.of(18, 0),
                60, 1, Set.of(DayOfWeek.WEDNESDAY), null, 2);
        List<Instant> starts = List.of(SLOT.start(), shifted(SLOT, 7).start());

        // when
        SeriesCreationResult result = series.create(rule, starts, board.accountId(), board.personId(),
                Set.of(Role.ADMIN), null);

        // then
        assertThat(result.skipped()).isEmpty();
        assertThat(stateOf(entry)).isEqualTo("WITHDRAWN");
    }

    @Test
    void givenAMemberWaitingBehindASeries_whenTheBoardMovesTheSeriesAway_thenTheVacatedSlotIsOfferedToThem() {
        // given
        Member board = member("Mary", "Roe", Role.ADMIN);
        UUID moved = bookingFixture.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 13),
                LocalTime.of(18, 0), 60, 2, board.accountId(), board.personId(), Set.of(Role.ADMIN));
        UUID entry = join(first, SLOT);

        // when
        bookingFixture.moveWholeSeries(moved, LocalTime.of(20, 0), board.accountId(), Set.of(Role.ADMIN));

        // then
        assertThat(stateOf(entry)).as("a move hands the slot it vacates to the queue").isEqualTo("OFFERED");
    }

    @Test
    void givenTwoOverlappingOffers_whenWrittenStraightToTheDatabase_thenTheExclusionConstraintRefusesTheSecond() {
        // given
        UUID one = insertWaiting(first, SLOT);
        UUID other = insertWaiting(second, new TimeSlot(SLOT.start().plus(30, ChronoUnit.MINUTES),
                SLOT.end().plus(30, ChronoUnit.MINUTES)));
        offerStraight(one);

        // when / then
        assertThatThrownBy(() -> offerStraight(other))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("waitlist_entry_one_offer");
    }

    private void offerStraight(UUID entry) {
        jdbc.sql("""
                        UPDATE waitlist_entry SET state = 'OFFERED', offered_at = :now, offer_expires_at = starts_at
                        WHERE id = :id
                        """)
                .param("now", java.sql.Timestamp.from(NOW)).param("id", entry).update();
    }

    private UUID offerTo(Member member) {
        UUID booking = book(holder, SLOT);
        UUID entry = join(member, SLOT);
        join(member == second ? first : second, SLOT);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        assertThat(stateOf(entry)).isEqualTo("OFFERED");
        return entry;
    }

    private UUID insertWaiting(Member member, TimeSlot slot) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO waitlist_entry (id, account_id, court_id, card_id, starts_at, ends_at, state, joined_at)
                        VALUES (:id, :account, :court, :card, :startsAt, :endsAt, 'WAITING', :now)
                        """)
                .param("id", id).param("account", member.accountId()).param("court", court)
                .param("card", MEMBER_CARD).param("startsAt", java.sql.Timestamp.from(slot.start()))
                .param("endsAt", java.sql.Timestamp.from(slot.end())).param("now", java.sql.Timestamp.from(NOW))
                .update();
        return id;
    }

    private void insertClosed(Member member, TimeSlot slot, String state, UUID bookingId) {
        jdbc.sql("""
                        INSERT INTO waitlist_entry (id, account_id, court_id, card_id, starts_at, ends_at, state, joined_at,
                                                    closed_at, booking_id)
                        VALUES (:id, :account, :court, :card, :startsAt, :endsAt, :state, :now, :now, :booking)
                        """)
                .param("id", UUID.randomUUID()).param("account", member.accountId()).param("court", court)
                .param("card", MEMBER_CARD).param("startsAt", java.sql.Timestamp.from(slot.start()))
                .param("endsAt", java.sql.Timestamp.from(slot.end())).param("state", state)
                .param("now", java.sql.Timestamp.from(NOW)).param("booking", bookingId)
                .update();
    }

    private UUID join(Member member, TimeSlot slot) {
        return waitlist.join(new JoinWaitlistCommand(court, MEMBER_CARD, slot, member.accountId(), member.personId(),
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner.personId()))));
    }

    private UUID book(Member member, TimeSlot slot) {
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, slot, member.accountId(),
                member.personId(), Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner.personId())),
                null));
    }

    private Member member(String firstName, String lastName, Role role) {
        UUID person = identity.createPerson(firstName, lastName,
                (firstName + "." + lastName + "." + role).toLowerCase() + "@example.org");
        return new Member(identity.createEnabledAccount(person, (lastName + "." + firstName + "." + role).toLowerCase(),
                Set.of(role)), person);
    }

    private static TimeSlot shifted(TimeSlot slot, int days) {
        return new TimeSlot(slot.start().plus(days, ChronoUnit.DAYS), slot.end().plus(days, ChronoUnit.DAYS));
    }

    private UUID offeredEntry() {
        return jdbc.sql("SELECT id FROM waitlist_entry WHERE state = 'OFFERED'").query(UUID.class).single();
    }

    private String stateOf(UUID entry) {
        return jdbc.sql("SELECT state FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(String.class).single();
    }

    private Instant expiryOf(UUID entry) {
        return jdbc.sql("SELECT offer_expires_at FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(java.sql.Timestamp.class).single().toInstant();
    }

    private int entries() {
        return jdbc.sql("SELECT count(*) FROM waitlist_entry").query(Integer.class).single();
    }

    private int confirmedOnCourt() {
        return jdbc.sql("""
                        SELECT count(*) FROM court_allocation
                        WHERE court_id = :court AND status = 'CONFIRMED' AND starts_at < :endsAt AND ends_at > :startsAt
                        """)
                .param("court", court).param("startsAt", java.sql.Timestamp.from(SLOT.start()))
                .param("endsAt", java.sql.Timestamp.from(SLOT.end()))
                .query(Integer.class).single();
    }
}
