package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AccessPassLivenessTest extends AccessPassTestSupport {

    private static final Step UNREACHABLE = new Step.Probe(new ProbeOutcome.Unreachable("connection refused"));

    @Test
    void givenAnOutageOverSeveralPasses_whenTheProbeRecovers_thenTheGrantIsInstalledWithoutAnyAction() {
        // given
        UUID booking = book(courts.get(0));
        connector.nextProbes(UNREACHABLE, UNREACHABLE, UNREACHABLE);
        List<PassResult> outages = new ArrayList<>();
        for (int minute = 0; minute < 3; minute++) {
            outages.add(passAt(START.plus(Duration.ofMinutes(minute))));
        }
        AccessGrant duringTheOutage = grantOf(booking);
        boolean codeDuringTheOutage = currentCode(booking).isPresent();

        // when
        passAt(START.plus(Duration.ofMinutes(3)));

        // then
        assertThat(outages).containsOnly(new PassResult.Outage());
        assertThat(duringTheOutage.getAttempts()).as("an outage counts against no grant").isZero();
        assertThat(duringTheOutage.isWanted()).as("an outage leaves the inserted row as it was").isFalse();
        assertThat(codeDuringTheOutage).isFalse();
        assertThat(connector.calls(Kind.GRANT)).hasSize(1);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenAProbeThatEndsAtTheConnectorsOwnDeadline_whenThePassRuns_thenTheReadingIsATimeout() {
        // given
        book(courts.get(0));
        connector.nextProbes(new Step.Fail(new LoxoneClient.Late("getuserlist2")));

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.Outage());
        assertThat(readings.latest()).get().extracting(ProbeReadings.Reading::classification)
                .as("a call the connector ended at its deadline is a timeout, not an unreachable system")
                .isEqualTo(ProbeClassification.TIMEOUT);
    }

    @Test
    void givenAProbeThatFailsOtherwise_whenThePassRuns_thenTheReadingIsUnreachable() {
        // given
        book(courts.get(0));
        connector.nextProbes(new Step.Fail(new LoxoneFailure("getuserlist2 failed: IOException")));

        // when
        pass.runPassNow();

        // then
        assertThat(readings.latest()).get().extracting(ProbeReadings.Reading::classification)
                .isEqualTo(ProbeClassification.UNREACHABLE);
    }

    @Test
    void givenAConnectorThatLostItsRight_whenItRegainsIt_thenEveryGrantProceedsWithoutPerGrantAction() {
        // given
        UUID first = book(courts.get(0));
        UUID second = book(courts.get(1));
        connector.nextInstalls(new Step.Answer(new GrantOutcome.Refused(Scope.CONNECTOR, "403 no user management")));
        connector.nextProbes(new Step.Probe(new ProbeOutcome.Answered()),
                new Step.Probe(new ProbeOutcome.Refused("403 no user management")));
        PassResult lostTheRight = pass.runPassNow();
        int callsWhileRefused = connector.calls(Kind.GRANT).size();

        // when
        passAt(START.plusSeconds(60));

        // then
        assertThat(lostTheRight).isEqualTo(new PassResult.Outage());
        assertThat(callsWhileRefused).as("the pass stops at the first refusal for the connector").isOne();
        assertThat(grantOf(first).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grantOf(second).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grantOf(first).getAttempts()).isZero();
        assertThat(grantOf(first).isRefused()).isFalse();
        assertThat(grantOf(second).isRefused()).isFalse();
    }

    @Test
    void givenOneRowThatNeverAnswersClearly_whenPassesRun_thenTheOtherRowsAreStillInstalledAndRevoked() {
        // given
        UUID stuck = book(courts.get(0));
        UUID installed = book(courts.get(1));
        UUID revoked = book(courts.get(0), new TimeSlot(EVENING.end(),
                EVENING.end().plus(Duration.ofHours(1))));
        insertWithoutCalls();
        connector.alwaysFor(grantIdOf(stuck), new Step.Fail(new IllegalStateException("socket reset")));
        pass.runPassNow();
        cancel(revoked);

        // when
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(grantOf(installed).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grantOf(revoked).getRemote()).isEqualTo(RemoteState.NONE);
        assertThat(grantOf(stuck).getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(grantOf(stuck).getAttempts()).isEqualTo(2);
    }

    @Test
    void givenTheSystemAsksTheConnectorToWait_whenThePassRecordsIt_thenThePassHoldsTheWorkerForThatLong() {
        // given
        book(courts.get(0));
        connector.nextInstalls(new Step.Answer(new GrantOutcome.RetryLater(Scope.CONNECTOR,
                START.plus(Duration.ofMinutes(10)), "429 locked after requests without rights")));

        // when
        PassResult result = pass.runPassNow();

        // then
        assertThat(result).isEqualTo(new PassResult.Held(Duration.ofMinutes(10)));
    }

    @Test
    void givenAnInstallThatKeepsFailing_whenItIsRetriedEachTimeItIsDue_thenTheBackoffGrowsToAnHour() {
        // given
        UUID booking = book(courts.get(0));
        connector.everyInstall(new Step.Fail(new IllegalStateException("socket reset")));
        List<Duration> backoffs = new ArrayList<>();

        // when
        Instant at = START;
        for (int attempt = 0; attempt < 5; attempt++) {
            passAt(at);
            Instant next = grantOf(booking).getNextAttemptAt();
            backoffs.add(Duration.between(at, next));
            at = next;
        }

        // then
        assertThat(backoffs).containsExactly(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15),
                Duration.ofMinutes(60), Duration.ofMinutes(60));
    }
}
