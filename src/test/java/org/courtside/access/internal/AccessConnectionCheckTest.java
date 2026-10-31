package org.courtside.access.internal;

import org.courtside.access.CheckOutcome;
import org.courtside.access.CheckResult;
import org.courtside.access.ConnectionCheck;
import org.courtside.access.GrantStatus;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class AccessConnectionCheckTest extends AccessPassTestSupport {

    private static final CheckResult FINE = CheckResult.passed("access.check.example.fine", Map.of());

    @Autowired
    private AccessGrantAdministration administration;

    @Test
    void givenAHangingAThrowingAndASilentCheck_whenThePassRuns_thenEachReportsAloneAndTheGrantIsStillInstalled() {
        // given
        connector.checks(
                new ConnectionCheck("hanging", List.of(), () -> {
                    sleepInterruptibly(Duration.ofMinutes(5));
                    return FINE;
                }),
                new ConnectionCheck("throwing", List.of(), () -> {
                    throw new IllegalStateException("the check broke");
                }),
                new ConnectionCheck("silent", List.of(), () -> null),
                new ConnectionCheck("fine", List.of(), () -> FINE),
                new ConnectionCheck("dependent", List.of("throwing"), () -> FINE));
        UUID booking = book(courts.get(0));
        administration.requestConnectionCheck();

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).as("a failing check never stops the grant pass").isEqualTo(new PassResult.Completed());
        assertThat(grantOf(booking).status()).isEqualTo(GrantStatus.INSTALLED);
        assertThat(administration.connectionCheck().checks()).extracting(
                AccessGrantAdministration.CheckView::check, AccessGrantAdministration.CheckView::outcome,
                AccessGrantAdministration.CheckView::code, AccessGrantAdministration.CheckView::parameters)
                .containsExactly(
                        tuple("hanging", CheckOutcome.FAILED, "access.check.timeout",
                                Map.of()),
                        tuple("throwing", CheckOutcome.FAILED, "access.check.failed",
                                Map.of()),
                        tuple("silent", CheckOutcome.FAILED, "access.check.unanswered",
                                Map.of()),
                        tuple("fine", CheckOutcome.PASSED, "access.check.example.fine",
                                Map.of()),
                        tuple("dependent", CheckOutcome.SKIPPED, "access.check.skipped",
                                Map.of("requires", "throwing")));
        assertThat(administration.connectionCheck().checkedAt()).isEqualTo(START);
    }

    @Test
    void givenACheckIgnoringItsDeadline_whenThePassRuns_thenTheNextCheckSaysTheCallThreadIsOccupied() {
        // given
        CountDownLatch release = new CountDownLatch(1);
        connector.checks(
                new ConnectionCheck("stubborn", List.of(), () -> {
                    awaitIgnoringInterrupts(release);
                    return FINE;
                }),
                new ConnectionCheck("next", List.of(), () -> FINE));
        administration.requestConnectionCheck();

        // when
        try {
            pass.runPassNow();
        } finally {
            release.countDown();
        }

        // then
        assertThat(administration.connectionCheck().checks()).extracting(AccessGrantAdministration.CheckView::code)
                .containsExactly("access.check.timeout", "access.check.callThreadOccupied");
    }

    @Test
    void givenAccessPointsWithAndWithoutAStaticCode_whenChecked_thenOnlyThoseReceivingGrantsAreHandedOver() {
        // given
        facility.createAccessPoint("Clubhouse", courts.subList(0, 1), "735104");
        administration.requestConnectionCheck();

        // when
        pass.runPassNow();

        // then
        assertThat(connector.checkedAccessPoints()).as("an access point with a static code receives no grant")
                .isEqualTo(Map.of(northGate, "North gate", southGate, "South gate"));
    }

    @Test
    void givenAConnectorWithoutChecksOfItsOwn_whenChecked_thenOneResultSaysSoAndTheSystemIsProbed() {
        // given
        administration.requestConnectionCheck();

        // when
        pass.runPassNow();

        // then
        assertThat(administration.connectionCheck().checks()).singleElement().satisfies(entry -> {
            assertThat(entry.check()).isEqualTo("connector");
            assertThat(entry.outcome()).isEqualTo(CheckOutcome.SKIPPED);
            assertThat(entry.code()).isEqualTo("access.check.connector.notOffered");
        });
        assertThat(connector.calls(Kind.PROBE)).as("the check includes the probe, which reloads the groups")
                .hasSize(1);
        assertThat(readings.latest()).isPresent();
    }

    @Test
    void givenAConnectorThatCannotListItsChecks_whenChecked_thenTheBoardReadsAFailureAndTheGrantIsInstalled() {
        // given
        connector.failsListingChecks(new IllegalStateException("no checks today"));
        UUID booking = book(courts.get(0));
        administration.requestConnectionCheck();

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.Completed());
        assertThat(grantOf(booking).status()).isEqualTo(GrantStatus.INSTALLED);
        assertThat(administration.connectionCheck().checks()).as("a check that could not start still reports")
                .extracting(AccessGrantAdministration.CheckView::check, AccessGrantAdministration.CheckView::outcome,
                        AccessGrantAdministration.CheckView::code)
                .containsExactly(tuple("connector", CheckOutcome.FAILED, "access.check.failed"));
    }

    @Test
    void givenThePassLosesItsLockDuringACheck_whenTheNextCheckWouldRun_thenItStopsKeepsNoReportAndStaysRequested() {
        // given
        AtomicBoolean secondRan = new AtomicBoolean();
        connector.checks(
                new ConnectionCheck("first", List.of(), () -> {
                    terminateThePassLockSession();
                    return FINE;
                }),
                new ConnectionCheck("second", List.of(), () -> {
                    secondRan.set(true);
                    return FINE;
                }));
        administration.requestConnectionCheck();

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.LockLost());
        assertThat(secondRan).as("no check runs once the lock is gone").isFalse();
        assertThat(administration.connectionCheck().checkedAt()).as("a cut-short run keeps no report").isNull();
        assertThat(checkReadings.takeRequest()).as("the next pass that holds the lock runs it").isTrue();
    }

    @Test
    void givenThePassIsStoppingDuringACheck_whenTheNextCheckWouldRun_thenItStopsKeepsNoReportAndStaysRequested() {
        // given
        AtomicBoolean stopping = new AtomicBoolean();
        AtomicBoolean secondRan = new AtomicBoolean();
        connector.checks(
                new ConnectionCheck("first", List.of(), () -> {
                    stopping.set(true);
                    return FINE;
                }),
                new ConnectionCheck("second", List.of(), () -> {
                    secondRan.set(true);
                    return FINE;
                }));
        book(courts.get(0));
        administration.requestConnectionCheck();

        // when
        PassResult result = pass.runPassNow(stopping::get);

        // then
        assertThat(result).isEqualTo(new PassResult.Stopped());
        assertThat(secondRan).as("no check runs once the worker stops").isFalse();
        assertThat(administration.connectionCheck().checkedAt()).as("a cut-short run keeps no report").isNull();
        assertThat(checkReadings.takeRequest()).as("the next pass runs it").isTrue();
    }

    private void terminateThePassLockSession() {
        jdbc.sql("""
                        SELECT pg_terminate_backend(pid) FROM pg_locks
                        WHERE locktype = 'advisory' AND classid = 0 AND objid = ? AND objsubid = 1
                        """).params(PassLock.KEY).query().listOfRows();
    }

    @Test
    void givenNoRequest_whenThePassRuns_thenNoCheckRuns() {
        // given
        connector.checks(new ConnectionCheck("fine", List.of(), () -> FINE));

        // when
        pass.runPassNow();

        // then
        assertThat(administration.connectionCheck().checkedAt()).isNull();
        assertThat(administration.connectionCheck().checks()).isEmpty();
        assertThat(connector.checkedAccessPoints()).as("the connector is not even asked for its checks").isNull();
    }

    @Test
    void givenARequestedCheck_whenTwoPassesRun_thenOnlyTheFirstChecks() {
        // given
        connector.checks(new ConnectionCheck("fine", List.of(), () -> FINE));
        administration.requestConnectionCheck();
        pass.runPassNow();

        // when
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(administration.connectionCheck().checkedAt()).as("a request is consumed once").isEqualTo(START);
    }

    private static void sleepInterruptibly(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException abandoned) {
            Thread.currentThread().interrupt();
        }
    }

    private static void awaitIgnoringInterrupts(CountDownLatch release) {
        boolean released = false;
        while (!released) {
            try {
                released = release.await(1, TimeUnit.MINUTES);
            } catch (InterruptedException ignored) {
                released = false;
            }
        }
    }
}
