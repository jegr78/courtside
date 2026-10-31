package org.courtside.access.internal;

import org.courtside.access.AccessGrantEvent;
import org.courtside.identity.Role;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.BookingReleased;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AccessSignalsTest extends AccessPassTestSupport {

    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Duration QUIET = Duration.ofMillis(400);
    private static final Duration PATIENCE = Duration.ofSeconds(5);

    @Autowired
    private AccessWorker worker;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private AccessGrantAdministration administration;

    @BeforeEach
    void startTheWorker() {
        worker.start();
    }

    @AfterEach
    void stopTheWorker() {
        worker.stop();
    }

    @Test
    void givenAnIdleWorker_whenABookingIsConfirmed_thenAPassStartsAtOnce() {
        // when / then
        assertThat(passStartsAfter(() -> book(courts.get(0)))).isTrue();
    }

    @Test
    void givenAnIdleWorker_whenABookingIsCancelled_thenAPassStartsAtOnce() {
        // given
        UUID booking = book(courts.get(0));

        // when / then
        assertThat(passStartsAfter(() -> cancel(booking))).isTrue();
    }

    @Test
    void givenAnIdleWorker_whenASeriesIsCreatedMovedAndCancelled_thenEachStartsAPass() {
        // given
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        UUID[] series = new UUID[1];

        // when / then
        assertThat(passStartsAfter(() -> series[0] = createSeries())).as("created").isTrue();
        assertThat(passStartsAfter(() -> bookings.moveWholeSeries(series[0], LocalTime.of(18, 0), account(),
                Set.of(Role.ADMIN)))).as("moved in time").isTrue();
        assertThat(passStartsAfter(() -> bookings.moveWholeSeriesToCourt(series[0], courts.get(1), account(),
                Set.of(Role.ADMIN)))).as("moved to another court").isTrue();
        assertThat(passStartsAfter(() -> bookings.cancelWholeSeries(series[0], account(), Set.of(Role.ADMIN))))
                .as("cancelled").isTrue();
    }

    @Test
    void givenAnIdleWorker_whenABookingIsReleasedOrDisplaced_thenEachStartsAPass() {
        // given
        UUID booking = book(courts.get(0));

        // when / then
        assertThat(passStartsAfter(() -> publish(new BookingReleased(booking)))).as("released").isTrue();
        assertThat(passStartsAfter(() -> publish(new BookingDisplaced(booking,
                BookingDisplaced.Closure.COURT_OUT_OF_SERVICE)))).as("displaced").isTrue();
    }

    @Test
    void givenAnIdleWorker_whenACardStopsOrStartsGrantingAccess_thenEachStartsAPass() {
        // when / then
        assertThat(passStartsAfter(() -> cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, false)))
                .as("switched off").isTrue();
        assertThat(passStartsAfter(() -> cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true)))
                .as("switched on").isTrue();
    }

    @Test
    void givenAnIdleWorker_whenAnAccessPointIsAddedChangedOrSwitched_thenEachStartsAPass() {
        // when / then
        assertThat(passStartsAfter(() -> facility.createAccessPoint("East gate", courts, null))).as("added")
                .isTrue();
        assertThat(passStartsAfter(() -> facility.changeAccessPoint(northGate, "North gate", courts, null)))
                .as("its gate assignment").isTrue();
        assertThat(passStartsAfter(() -> facility.changeAccessPoint(northGate, "North gate", courts, "246810")))
                .as("its static code").isTrue();
        assertThat(passStartsAfter(() -> facility.deactivateAccessPoint(southGate))).as("deactivated").isTrue();
        assertThat(passStartsAfter(() -> facility.activateAccessPoint(southGate))).as("reactivated").isTrue();
    }

    @Test
    void givenAnIdleWorker_whenABoardRetriesAGrant_thenAPassStartsAtOnce() {
        // when / then
        assertThat(passStartsAfter(() -> publish(new AccessGrantEvent.RetryRequested(UUID.randomUUID(),
                UUID.randomUUID())))).isTrue();
    }

    @Test
    void givenAnIdleWorker_whenABoardAsksForAProbe_thenAPassStartsAtOnce() {
        // when / then
        assertThat(passStartsAfter(administration::requestProbe)).isTrue();
    }

    @Test
    void givenAnIdleWorker_whenABoardAsksForAConnectionCheck_thenAPassStartsAtOnce() {
        // when / then
        assertThat(passStartsAfter(administration::requestConnectionCheck)).isTrue();
    }

    private boolean passStartsAfter(Runnable change) {
        long before = quietReads();
        change.run();
        long deadline = System.nanoTime() + PATIENCE.toNanos();
        while (System.nanoTime() < deadline) {
            if (clock.reads() > before) {
                return true;
            }
            pause(Duration.ofMillis(20));
        }
        return false;
    }

    private long quietReads() {
        long deadline = System.nanoTime() + PATIENCE.multipliedBy(2).toNanos();
        long reads = clock.reads();
        while (System.nanoTime() < deadline) {
            pause(QUIET);
            long now = clock.reads();
            if (now == reads) {
                return now;
            }
            reads = now;
        }
        throw new AssertionError("The worker never went idle");
    }

    private void publish(Object event) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> events.publishEvent(event));
    }

    private UUID createSeries() {
        return bookings.createSeries(courts.get(0), TRAINING_CARD, LocalDate.of(2026, 5, 12),
                LocalTime.of(16, 0), 60, 2, account(), person(), Set.of(Role.ADMIN));
    }

    private static void pause(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }
}
