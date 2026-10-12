package org.courtside.booking.waitlist;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.sql.Timestamp;
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
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class WaitlistConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));
    private static final String INTRUDER = "waitlist-intruder";
    private static final Duration SETTLE = Duration.ofSeconds(15);

    @MockitoSpyBean
    private WaitlistRows rows;

    @Autowired
    private WaitlistService waitlist;

    @Autowired
    private WaitlistQueue queue;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private UUID partner;
    private Member holder;

    record Member(UUID accountId, UUID personId) {
    }

    @BeforeEach
    void aCourtHeldByOneMember() {
        court = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        partner = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        holder = member(0);
    }

    @Test
    void givenABookingPastItsReservationCheck_whenTheSlotIsCancelledMeanwhile_thenItNeverMeetsTheOffer()
            throws Exception {
        // given
        UUID booking = book(holder);
        Member waiting = member(1);
        Member intruder = member(2);
        UUID entry = join(waiting);
        CountDownLatch checked = new CountDownLatch(1);
        List<Future<?>> cancellation = new ArrayList<>();
        doAnswer(invocation -> {
            Object answer = invocation.callRealMethod();
            if (Thread.currentThread().getName().equals(INTRUDER)) {
                checked.countDown();
                awaitCancellationBlockedOrDone(cancellation);
            }
            return answer;
        }).when(rows).offeredCourts(any(), any(), any());

        // when
        try (ExecutorService intruding = Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, INTRUDER));
             ExecutorService cancelling = Executors.newSingleThreadExecutor()) {
            Future<Boolean> intrusion = intruding.submit(() -> booked(() -> book(intruder)));
            if (!checked.await(40, TimeUnit.SECONDS)) {
                throw new AssertionError("The intruding booking never reached its reservation check");
            }
            cancellation.add(cancelling.submit(() -> bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER))));
            PostgresDiagnostics.await(cancellation.getFirst(), Duration.ofSeconds(40), jdbc, "Cancellation");
            PostgresDiagnostics.await(intrusion, Duration.ofSeconds(40), jdbc, "Intruding booking");
        }

        // then
        assertThat(confirmedOnCourt())
                .as("a booking that read the court as unreserved must not take it once the cancellation offered it")
                .isZero();
        assertThat(offeredOnCourt()).containsExactly(entry);
    }

    @Test
    void givenMembersJoiningAtOnce_whenTheSlotFrees_thenTheEarliestJoinedIsTheOnlyOneOffered() throws Exception {
        // given
        UUID booking = book(holder);
        List<Member> waiting = new ArrayList<>();
        for (int index = 1; index <= 6; index++) {
            waiting.add(member(index));
        }
        CountDownLatch start = new CountDownLatch(1);
        List<Callable<UUID>> joins = waiting.stream().<Callable<UUID>>map(member -> () -> {
            start.await();
            return join(member);
        }).toList();

        // when
        List<Future<UUID>> joined;
        try (ExecutorService pool = Executors.newFixedThreadPool(joins.size())) {
            joined = joins.stream().map(pool::submit).toList();
            start.countDown();
            for (Future<UUID> future : joined) {
                PostgresDiagnostics.await(future, Duration.ofSeconds(40), jdbc, "Join");
            }
        }
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // then
        UUID earliest = jdbc.sql("SELECT id FROM waitlist_entry ORDER BY joined_seq LIMIT 1")
                .query(UUID.class).single();
        assertThat(offeredOnCourt()).as("FIFO: only the earliest joined entry holds the offer")
                .containsExactly(earliest);
        assertThat(jdbc.sql("SELECT count(*) FROM waitlist_entry WHERE state = 'WAITING'")
                .query(Integer.class).single()).isEqualTo(5);
    }

    @Test
    void givenAnOffer_whenItsHolderAcceptsWhileOthersBookAndItIsDeclined_thenBookingAndOfferNeverMeet()
            throws Exception {
        // given
        UUID booking = book(holder);
        Member offered = member(1);
        UUID entry = join(offered);
        List<Member> others = List.of(member(2), member(3), member(4), member(5));
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        CountDownLatch start = new CountDownLatch(1);
        List<Callable<Boolean>> racing = new ArrayList<>();
        racing.add(() -> {
            start.await();
            return booked(() -> waitlist.accept(entry, offered.accountId(), offered.personId(), Set.of(Role.MEMBER)));
        });
        racing.add(() -> {
            start.await();
            return booked(() -> {
                waitlist.leave(entry, offered.accountId());
                return null;
            });
        });
        others.forEach(other -> racing.add(() -> {
            start.await();
            return booked(() -> book(other));
        }));

        // when
        List<Boolean> outcomes = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(racing.size())) {
            List<Future<Boolean>> running = racing.stream().map(pool::submit).toList();
            start.countDown();
            for (Future<Boolean> future : running) {
                outcomes.add(PostgresDiagnostics.await(future, Duration.ofSeconds(40), jdbc, "Racing call"));
            }
        }

        // then
        assertThat(outcomes.subList(0, 2)).as("the offer's member always gets to accept or decline it").contains(true);
        assertThat(stateOf(entry)).as("the offer ends as the member's booking or their decline, never left standing")
                .isIn("BOOKED", "LEFT");
        assertThat(offeredOnCourt()).isEmpty();
        assertThat(confirmedOnCourt()).as("never two bookings on one court and time").isLessThanOrEqualTo(1);
        assertThat(offeredOnCourt().size() + confirmedOnCourt())
                .as("a booking and an offer never hold the slot together").isLessThanOrEqualTo(1);
        List<UUID> holders = jdbc.sql("""
                        SELECT b.booked_by FROM booking b JOIN court_allocation a ON a.booking_id = b.id
                        WHERE a.court_id = :court AND a.status = 'CONFIRMED'
                        """).param("court", court).query(UUID.class).list();
        String state = stateOf(entry);
        if (!holders.isEmpty() && !holders.getFirst().equals(offered.accountId())) {
            assertThat(state).as("somebody else books the slot only after its offer was declined").isEqualTo("LEFT");
        }
    }

    @Test
    void givenAnOfferPastItsDeadline_whenItsMemberAcceptsWhileTheSweepRuns_thenItExpiresAndPassesOnOnce()
            throws Exception {
        // given
        UUID booking = book(holder);
        Member offered = member(1);
        Member next = member(2);
        UUID entry = join(offered);
        UUID following = join(next);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        jdbc.sql("UPDATE waitlist_entry SET offer_expires_at = :due WHERE id = :id")
                .param("due", Timestamp.from(NOW)).param("id", entry).update();

        // when
        List<Boolean> outcomes = race(
                () -> booked(() -> waitlist.accept(entry, offered.accountId(), offered.personId(), Set.of(Role.MEMBER))),
                () -> {
                    queue.sweep();
                    return true;
                });

        // then
        assertThat(outcomes.getFirst()).as("an offer past its deadline is not accepted").isFalse();
        assertThat(stateOf(entry)).isEqualTo("EXPIRED");
        assertThat(offeredOnCourt()).as("the next member is offered the slot exactly once").containsExactly(following);
        assertThat(confirmedOnCourt()).isZero();
    }

    @Test
    void givenAnOpenOffer_whenItsMemberAcceptsWhileTheSweepRuns_thenTheAcceptanceStandsAndNothingPassesOn()
            throws Exception {
        // given
        UUID booking = book(holder);
        Member offered = member(1);
        UUID entry = join(offered);
        UUID following = join(member(2));
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));

        // when
        List<Boolean> outcomes = race(
                () -> booked(() -> waitlist.accept(entry, offered.accountId(), offered.personId(), Set.of(Role.MEMBER))),
                () -> {
                    queue.sweep();
                    return true;
                });

        // then
        assertThat(outcomes.getFirst()).as("an open offer is accepted whatever the sweep does").isTrue();
        assertThat(stateOf(entry)).isEqualTo("BOOKED");
        assertThat(stateOf(following)).isEqualTo("WAITING");
        assertThat(confirmedOnCourt()).isEqualTo(1);
    }

    @Test
    void givenAnOffer_whenItsMemberAcceptsWhileTheBoardBooksTheCourt_thenExactlyOneOfThemHoldsIt() throws Exception {
        // given
        UUID booking = book(holder);
        Member offered = member(1);
        UUID entry = join(offered);
        bookings.cancel(booking, holder.accountId(), Set.of(Role.MEMBER));
        UUID boardPerson = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID board = identity.createEnabledAccount(boardPerson, "major.mary", Set.of(Role.ADMIN));

        // when
        List<Boolean> outcomes = race(
                () -> booked(() -> waitlist.accept(entry, offered.accountId(), offered.personId(), Set.of(Role.MEMBER))),
                () -> booked(() -> bookings.create(new CreateBookingCommand(List.of(court), TRAINING_CARD, SLOT, board,
                        boardPerson, Set.of(Role.ADMIN), null, List.of(), null))));

        // then
        assertThat(outcomes).as("exactly one of them takes the court").containsExactlyInAnyOrder(true, false);
        assertThat(confirmedOnCourt()).isEqualTo(1);
        assertThat(stateOf(entry)).as("the member's acceptance or the board's withdrawal decides the offer")
                .isEqualTo(outcomes.getFirst() ? "BOOKED" : "WITHDRAWN");
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

    private String stateOf(UUID entry) {
        return jdbc.sql("SELECT state FROM waitlist_entry WHERE id = :id").param("id", entry)
                .query(String.class).single();
    }

    private boolean booked(Callable<?> attempt) throws Exception {
        try {
            attempt.call();
            return true;
        } catch (DomainFailure refused) {
            return false;
        }
    }

    private void awaitCancellationBlockedOrDone(List<Future<?>> cancellation) {
        long deadline = System.nanoTime() + SETTLE.toNanos();
        while (System.nanoTime() < deadline) {
            if (!cancellation.isEmpty() && cancellation.getFirst().isDone()) {
                return;
            }
            jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
            int blocked = jdbc.sql("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database() AND pid <> pg_backend_pid()
                              AND state = 'active' AND wait_event_type = 'Lock'
                            """).query(Integer.class).single();
            if (blocked > 0) {
                return;
            }
            try {
                Thread.sleep(20);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        throw new AssertionError("The cancellation neither finished nor waited on a lock. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private UUID join(Member member) {
        return waitlist.join(new JoinWaitlistCommand(court, MEMBER_CARD, SLOT, member.accountId(), member.personId(),
                Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner))));
    }

    private UUID book(Member member) {
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT, member.accountId(),
                member.personId(), Set.of(Role.MEMBER), null, List.of(ParticipantSpec.member(partner)), null));
    }

    private Member member(int index) {
        UUID person = identity.createPerson("Jane", "Doe", "jane.doe." + index + "@example.org");
        return new Member(identity.createEnabledAccount(person, "doe.jane." + index, Set.of(Role.MEMBER)), person);
    }

    private int confirmedOnCourt() {
        return jdbc.sql("""
                        SELECT count(*) FROM court_allocation
                        WHERE court_id = :court AND status = 'CONFIRMED' AND starts_at < :endsAt AND ends_at > :startsAt
                        """)
                .param("court", court).param("startsAt", Timestamp.from(SLOT.start()))
                .param("endsAt", Timestamp.from(SLOT.end()))
                .query(Integer.class).single();
    }

    private List<UUID> offeredOnCourt() {
        return jdbc.sql("SELECT id FROM waitlist_entry WHERE court_id = :court AND state = 'OFFERED'")
                .param("court", court).query(UUID.class).list();
    }
}
