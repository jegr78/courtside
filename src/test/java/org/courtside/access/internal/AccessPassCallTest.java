package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

class AccessPassCallTest extends AccessPassTestSupport {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessWorker worker;

    @Test
    void givenAnotherInstanceHoldsThePassLock_whenAPassStarts_thenItSkipsWithoutWritingOrCalling() {
        // given
        book(courts.get(0));
        PassLock elsewhere = PassLock.tryAcquire(dataSource).orElseThrow();

        // when
        PassResult result;
        try {
            result = pass.runPassNow();
        } finally {
            elsewhere.close();
        }

        // then
        assertThat(result).isEqualTo(new PassResult.Skipped());
        assertThat(connector.calls()).isEmpty();
        assertThat(jdbc.sql("SELECT count(*) FROM access_grant").query(Integer.class).single()).isZero();
    }

    @Test
    void givenThePassLosesItsLockDuringTheProbe_whenItWouldCallNext_thenItStopsBeforeTheCall() {
        // given
        book(courts.get(0));
        connector.nextProbes(new Step.Then(this::terminateThePassLockSession,
                new Step.Probe(new ProbeOutcome.Answered())));

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.LockLost());
        assertThat(connector.calls()).extracting(ScriptedAccessControl.Call::kind).containsExactly(Kind.PROBE);
    }

    @Test
    void givenThePassLosesItsLockWhileDeciding_whenItWouldProbe_thenItStopsBeforeTheProbe() {
        // given
        book(courts.get(0));
        connector.whileMapping(points -> terminateThePassLockSession());

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.LockLost());
        assertThat(connector.calls()).isEmpty();
    }

    @Test
    void givenThePassLosesItsLockDuringACall_whenItWouldReProbe_thenItStopsBeforeTheReProbe() {
        // given
        book(courts.get(0));
        connector.nextInstalls(new Step.Then(this::terminateThePassLockSession,
                new Step.Fail(new IllegalStateException("socket reset"))));

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.LockLost());
        assertThat(connector.calls()).extracting(ScriptedAccessControl.Call::kind)
                .containsExactly(Kind.PROBE, Kind.GRANT);
    }

    @Test
    void givenACallThatHangs_whenItsDeadlinePasses_thenItIsAbandonedAndRecordedAsUnclear() {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(new Step.Hang());
        long started = System.nanoTime();

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.Completed());
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(10));
        AccessGrant grant = grantOf(booking);
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getAttempts()).isOne();
        assertThat(grant.getLastFailure()).isEqualTo("The access-control system gave no clear answer");
    }

    @Test
    void givenACallThatIgnoresItsDeadline_whenFurtherCallsAreDue_thenEveryPassEndsAsAnOutageWithoutCalling() {
        // given
        UUID first = book(courts.get(0));
        UUID second = book(courts.get(1));
        connector.everyInstall(new Step.Stubborn());

        // when
        PassResult firstPass = pass.runPassNow();
        PassResult secondPass = passAt(START.plus(Duration.ofMinutes(5)));

        // then
        assertThat(firstPass).isEqualTo(new PassResult.Outage());
        assertThat(secondPass).isEqualTo(new PassResult.Outage());
        assertThat(connector.calls()).extracting(ScriptedAccessControl.Call::kind)
                .as("no call starts while the call thread is still busy")
                .containsExactly(Kind.PROBE, Kind.GRANT);
        assertThat(List.of(grantOf(first).getAttempts(), grantOf(second).getAttempts()))
                .as("a busy re-probe counts nothing").containsOnly(0);
    }

    @Test
    void givenManyRowsToInstall_whenAPassSendsThem_thenNoTwoCallsAreEverInFlightTogether() {
        // given
        List<UUID> booked = new ArrayList<>();
        for (int hour = 0; hour < 3; hour++) {
            for (UUID court : courts) {
                booked.add(book(court, new TimeSlot(EVENING.start().plus(Duration.ofHours(hour)),
                        EVENING.end().plus(Duration.ofHours(hour)))));
            }
        }

        // when
        pass.runPassNow();

        // then
        assertThat(connector.calls(Kind.GRANT)).hasSize(booked.size());
        assertThat(connector.calls()).noneMatch(ScriptedAccessControl.Call::overlapped);
    }

    @Test
    void givenAPassWithManyRows_whenTheWorkerStopsDuringIt_thenThePassEndsBeforeTheNextRow() {
        // given
        book(courts.get(0));
        book(courts.get(1));
        book(courts.get(0), new TimeSlot(EVENING.end(), EVENING.end().plus(Duration.ofHours(1))));
        AtomicBoolean stopping = new AtomicBoolean();
        connector.everyInstall(new Step.Then(() -> stopping.set(true),
                new Step.Answer(new GrantOutcome.Accepted("remote-user"))));

        // when
        PassResult result = pass.runPassNow(stopping::get);

        // then
        assertThat(result).isEqualTo(new PassResult.Stopped());
        assertThat(connector.calls(Kind.GRANT)).as("a running call is finished, no new one starts").hasSize(1);
    }

    @Test
    void givenTheTestProfile_whenTheContextHasStarted_thenTheWorkerExistsButNeverRuns() {
        // when
        boolean running = worker.isRunning();

        // then
        assertThat(worker.isAutoStartup()).as("tests drive passes with runPassNow").isFalse();
        assertThat(running).isFalse();
    }

    private void terminateThePassLockSession() {
        jdbc.sql("""
                        SELECT pg_terminate_backend(pid) FROM pg_locks
                        WHERE locktype = 'advisory' AND classid = 0 AND objid = ? AND objsubid = 1
                        """).params(PassLock.KEY).query().listOfRows();
    }
}
