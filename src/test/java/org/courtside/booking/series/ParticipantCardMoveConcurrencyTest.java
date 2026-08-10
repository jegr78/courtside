package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class ParticipantCardMoveConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(10);

    private enum Outcome {
        MOVED,
        REJECTED
    }

    @Autowired
    private SeriesService seriesService;

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
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    private UUID seriesCourt;
    private UUID competingCourt;
    private UUID trainer;
    private UUID memberPersonId;

    @BeforeEach
    void setUp() {
        seriesCourt = courts.save(new Court(1, "Court 1")).getId();
        competingCourt = courts.save(new Court(2, "Court 2")).getId();
        trainer = UUID.randomUUID();
        memberPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenAMoveHoldingTheParticipantCard_whenAnotherSessionBooksIt_thenItWaitsAndIsRejected()
            throws Exception {
        // given
        SeriesCreationResult series = createSeries();
        Booking seriesBooking = bookings.findWithParticipantsById(series.bookingIds().getFirst()).orElseThrow();
        seriesBooking.addParticipant(ParticipantSpec.card(BALL_MACHINE));
        bookings.saveAndFlush(seriesBooking);
        CountDownLatch moveIsInPlace = new CountDownLatch(1);

        Callable<Outcome> holdMoveUncommitted = () -> {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                seriesService.move(new MoveRequest(
                        series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                        LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));
                moveIsInPlace.countDown();
                awaitASessionBlockedOnALock();
            });
            return Outcome.MOVED;
        };
        Callable<Outcome> contendForParticipantCard = () -> {
            moveIsInPlace.await();
            try {
                bookingService.create(new CreateBookingCommand(
                        List.of(competingCourt), MEMBER_BOOKING_CARD,
                        new TimeSlot(Instant.parse("2026-04-07T18:00:00Z"),
                                Instant.parse("2026-04-07T20:00:00Z")),
                        UUID.randomUUID(), memberPersonId, Set.of(Role.MEMBER), null,
                        List.of(ParticipantSpec.card(BALL_MACHINE)), null));
                return Outcome.MOVED;
            } catch (ParticipantsInvalidException failure) {
                return Outcome.REJECTED;
            }
        };

        // when
        List<Outcome> outcomes;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Outcome>> futures = pool.invokeAll(
                    List.of(holdMoveUncommitted, contendForParticipantCard));
            outcomes = List.of(futures.get(0).get(), futures.get(1).get());
        }

        // then
        assertThat(outcomes).containsExactly(Outcome.MOVED, Outcome.REJECTED);
        assertThat(bookings.countCardUsageOverlapping(BALL_MACHINE,
                Instant.parse("2026-04-07T18:00:00Z"),
                Instant.parse("2026-04-07T20:00:00Z"))).isOne();
    }

    private SeriesCreationResult createSeries() {
        SeriesRule rule = new SeriesRule(
                List.of(seriesCourt), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 1);
        List<Instant> starts = seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER))
                .occurrences().stream().map(occurrence -> occurrence.slot().start()).toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }

    private void awaitASessionBlockedOnALock() {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            if (sessionsBlockedOnALock() > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("No session waited for the participant card lock");
    }

    private int sessionsBlockedOnALock() {
        jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
        return jdbc.sql("""
                        SELECT count(*) FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND pid <> pg_backend_pid()
                          AND state = 'active'
                          AND wait_event_type = 'Lock'
                        """)
                .query(Integer.class)
                .single();
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failure);
        }
    }
}
