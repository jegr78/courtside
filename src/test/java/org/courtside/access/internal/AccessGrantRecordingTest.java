package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.access.internal.Grants.DEADLINE;
import static org.courtside.access.internal.Grants.DEMAND;
import static org.courtside.access.internal.Grants.MAPPING;
import static org.courtside.access.internal.Grants.NORTH_GATE;
import static org.courtside.access.internal.Grants.NOW;
import static org.courtside.access.internal.Grants.PROBE_ANSWERS;
import static org.courtside.access.internal.Grants.PROBE_FAILS;
import static org.courtside.access.internal.Grants.SOUTH_GATE;
import static org.courtside.access.internal.Grants.answered;
import static org.courtside.access.internal.Grants.decideAndBegin;
import static org.courtside.access.internal.Grants.fresh;
import static org.courtside.access.internal.Grants.installed;
import static org.courtside.access.internal.Grants.unclear;

class AccessGrantRecordingTest {

    private static final Instant LATER = NOW.plus(Duration.ofHours(1));
    private static final PassEffect CONTINUE = new PassEffect.Continue();
    private static final PassEffect OUTAGE = new PassEffect.Outage();

    @Test
    void givenAnInstallInFlight_whenItIsAccepted_thenTheGrantIsInstalledAsSent() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.decide(new Demand(DEMAND.validFrom(), DEMAND.validUntil(), Set.of(SOUTH_GATE)), "south-group", NOW);

        // when
        Recording recording = grant.record(call, answered(new GrantOutcome.Accepted("remote-user-1")), null,
                NOW.plusSeconds(2), DEADLINE);

        // then
        assertThat(recording).isEqualTo(new Recording(CONTINUE, false, true, false));
        assertThat(grant.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grant.getRemoteFrom()).isEqualTo(DEMAND.validFrom());
        assertThat(grant.getRemoteUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(grant.getRemotePoints()).as("the answer is a fact about what was sent").containsExactly(NORTH_GATE);
        assertThat(grant.getRemoteMapping()).isEqualTo(MAPPING);
        assertThat(grant.getFirstAcceptedAt()).isEqualTo(NOW.plusSeconds(2));
        assertThat(grant.getExternalReference()).isEqualTo("remote-user-1");
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getRejections()).isZero();
        assertThat(grant.getLastFailure()).isNull();
    }

    @Test
    void givenAGrantInstalledBefore_whenAnotherInstallIsAccepted_thenTheFirstAcceptanceIsKept() {
        // given
        AccessGrant grant = installed();
        SentCall call = decideAndBegin(grant, DEMAND, "north-group-v2", LATER);

        // when
        grant.record(call, answered(new GrantOutcome.Accepted("remote-user-1")), null, LATER, DEADLINE);

        // then
        assertThat(grant.getFirstAcceptedAt()).isEqualTo(NOW);
        assertThat(grant.getRemoteMapping()).isEqualTo("north-group-v2");
    }

    @Test
    void givenARevokeSentLongAfterTheLastInstall_whenItIsAccepted_thenNothingIsInstalledAnyMore() {
        // given
        AccessGrant grant = installed();
        SentCall call = decideAndBegin(grant, null, null, LATER);

        // when
        Recording recording = grant.record(call, answered(new GrantOutcome.Accepted("remote-user-1")), null, LATER,
                DEADLINE);

        // then
        assertThat(recording).isEqualTo(new Recording(CONTINUE, false));
        assertThat(grant.getRemote()).isEqualTo(RemoteState.NONE);
        assertThat(grant.getAttempts()).isZero();
    }

    @Test
    void givenARevokeSentWithinTwoDeadlinesOfAnInstall_whenItIsAccepted_thenOneMoreRevokeFollowsAtThatBound() {
        // given
        AccessGrant early = fresh();
        decideAndBegin(early, DEMAND, MAPPING, NOW);
        SentCall earlyRevoke = decideAndBegin(early, null, null, NOW.plus(DEADLINE));
        AccessGrant atTheBound = fresh();
        decideAndBegin(atTheBound, DEMAND, MAPPING, NOW);
        SentCall boundRevoke = decideAndBegin(atTheBound, null, null, NOW.plus(DEADLINE.multipliedBy(2)));

        // when
        early.record(earlyRevoke, answered(new GrantOutcome.Accepted("remote-user-1")), null, NOW.plus(DEADLINE),
                DEADLINE);
        atTheBound.record(boundRevoke, answered(new GrantOutcome.Accepted("remote-user-1")), null,
                NOW.plus(DEADLINE.multipliedBy(2)), DEADLINE);

        // then
        assertThat(early.getRemote()).as("the controller may still process the abandoned install")
                .isEqualTo(RemoteState.MAYBE);
        assertThat(early.getNextAttemptAt()).isEqualTo(NOW.plus(DEADLINE.multipliedBy(2)));
        assertThat(early.getAttempts()).isZero();
        assertThat(atTheBound.getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenAGrantAcceptedBefore_whenAnInstallReportsTheCodeRejected_thenTheGrantFailsAndKeepsItsCode() {
        // given
        AccessGrant grant = installed();
        SentCall call = decideAndBegin(grant, DEMAND, "north-group-v2", LATER);

        // when
        Recording recording = grant.record(call, answered(new GrantOutcome.CodeRejected()), null, LATER, DEADLINE);

        // then
        assertThat(recording).as("the delivered code must stay").isEqualTo(new Recording(CONTINUE, false, false, true));
        assertThat(grant.isRefused()).isTrue();
        assertThat(grant.getRejections()).isZero();
        assertThat(grant.getNextAttemptAt()).as("the possibly wrong installation is revoked next pass").isEqualTo(LATER);
    }

    @Test
    void givenARevoke_whenTheSystemReportsTheCodeRejected_thenItIsHandledAsAnUnclearAnswer() {
        // given
        AccessGrant grant = installed();
        SentCall call = decideAndBegin(grant, null, null, LATER);
        CallResult rejected = answered(new GrantOutcome.CodeRejected());

        // when
        boolean probes = AccessGrant.needsReProbe(call.action(), rejected);
        Recording recording = grant.record(call, rejected, PROBE_FAILS, LATER, DEADLINE);

        // then
        assertThat(probes).isTrue();
        assertThat(recording.effect()).isEqualTo(OUTAGE);
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getNextAttemptAt()).isEqualTo(LATER.plus(Duration.ofMinutes(1)));
        assertThat(grant.getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenRetryLaterForTheGrant_whenRecorded_thenTheLaterOfBackoffAndItsTimeApplies() {
        // given
        AccessGrant install = fresh();
        SentCall installCall = decideAndBegin(install, DEMAND, MAPPING, NOW);
        AccessGrant revoke = installed();
        SentCall revokeCall = decideAndBegin(revoke, null, null, NOW);
        AccessGrant soon = fresh();
        SentCall soonCall = decideAndBegin(soon, DEMAND, MAPPING, NOW);
        AccessGrant unstated = fresh();
        SentCall unstatedCall = decideAndBegin(unstated, DEMAND, MAPPING, NOW);
        Instant inTenMinutes = NOW.plus(Duration.ofMinutes(10));

        // when
        install.record(installCall, answered(new GrantOutcome.RetryLater(Scope.GRANT, inTenMinutes, "busy")), null,
                NOW, DEADLINE);
        revoke.record(revokeCall, answered(new GrantOutcome.RetryLater(Scope.GRANT, inTenMinutes, "busy")), null,
                NOW, DEADLINE);
        soon.record(soonCall, answered(new GrantOutcome.RetryLater(Scope.GRANT, NOW.plusSeconds(5), "busy")), null,
                NOW, DEADLINE);
        unstated.record(unstatedCall, answered(new GrantOutcome.RetryLater(Scope.GRANT, null, "busy")), null, NOW,
                DEADLINE);

        // then
        assertThat(install.getNextAttemptAt()).isEqualTo(inTenMinutes);
        assertThat(revoke.getNextAttemptAt()).isEqualTo(inTenMinutes);
        assertThat(soon.getNextAttemptAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        assertThat(unstated.getNextAttemptAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        assertThat(install.getLastFailure()).isEqualTo("busy");
        assertThat(install.getAttempts()).isOne();
    }

    @Test
    void givenAnInstallTheSystemRefusesForTheGrant_whenRecorded_thenTheGrantIsRefused() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        Recording recording = grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")),
                null, NOW, DEADLINE);

        // then
        assertThat(recording.effect()).isEqualTo(CONTINUE);
        assertThat(grant.isRefused()).isTrue();
        assertThat(grant.getNextAttemptAt()).as("what may be at the door is revoked next pass").isEqualTo(NOW);
        assertThat(grant.getLastFailure()).isEqualTo("keypad full");
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
    }

    @Test
    void givenARevokeTheSystemRefusesForTheGrant_whenRecorded_thenItStaysDueWithBackoff() {
        // given
        AccessGrant grant = installed();
        SentCall call = decideAndBegin(grant, null, null, LATER);

        // when
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "user locked")), null, LATER, DEADLINE);

        // then
        assertThat(grant.isRefused()).as("a revocation never stops").isFalse();
        assertThat(grant.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grant.getNextAttemptAt()).isEqualTo(LATER.plus(Duration.ofMinutes(1)));
        assertThat(grant.decide(null, null, LATER.plus(Duration.ofMinutes(1)))).isEqualTo(Action.REVOKE);
    }

    @Test
    void givenARefusalForTheConnector_whenTheReProbeFails_thenTheAttemptIsUndoneAndThePassEnds() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        CallResult refused = answered(new GrantOutcome.Refused(Scope.CONNECTOR, "403 no user management"));

        // when
        boolean probes = AccessGrant.needsReProbe(call.action(), refused);
        Recording recording = grant.record(call, refused, PROBE_FAILS, NOW, DEADLINE);

        // then
        assertThat(probes).isTrue();
        assertThat(recording.effect()).isEqualTo(OUTAGE);
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW);
        assertThat(grant.isRefused()).as("the grant is not at fault").isFalse();
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getExposedUntil()).isEqualTo(DEMAND.validUntil());
    }

    @Test
    void givenARefusalForTheConnector_whenTheReProbeAnswers_thenItCountsAsARefusalOfTheGrant() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        Recording recording = grant.record(call,
                answered(new GrantOutcome.Refused(Scope.CONNECTOR, "403 no user management")), PROBE_ANSWERS, NOW,
                DEADLINE);

        // then
        assertThat(recording.effect()).isEqualTo(CONTINUE);
        assertThat(grant.isRefused()).isTrue();
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW);
        assertThat(grant.getAttempts()).isOne();
    }

    @Test
    void givenRetryLaterForTheConnector_whenRecorded_thenTheWorkerIsHeldAtMostAnHour() {
        // given
        AccessGrant soon = fresh();
        SentCall soonCall = decideAndBegin(soon, DEMAND, MAPPING, NOW);
        AccessGrant late = fresh();
        SentCall lateCall = decideAndBegin(late, DEMAND, MAPPING, NOW);
        AccessGrant unstated = fresh();
        SentCall unstatedCall = decideAndBegin(unstated, DEMAND, MAPPING, NOW);
        Instant inTenMinutes = NOW.plus(Duration.ofMinutes(10));

        // when
        Recording soonRecording = soon.record(soonCall,
                answered(new GrantOutcome.RetryLater(Scope.CONNECTOR, inTenMinutes, "429")), PROBE_ANSWERS, NOW,
                DEADLINE);
        Recording lateRecording = late.record(lateCall,
                answered(new GrantOutcome.RetryLater(Scope.CONNECTOR, NOW.plus(Duration.ofHours(5)), "429")),
                PROBE_FAILS, NOW, DEADLINE);
        Recording unstatedRecording = unstated.record(unstatedCall,
                answered(new GrantOutcome.RetryLater(Scope.CONNECTOR, null, "429")), PROBE_ANSWERS, NOW, DEADLINE);

        // then
        assertThat(soonRecording.effect()).isEqualTo(new PassEffect.Hold(inTenMinutes));
        assertThat(soon.getAttempts()).as("a probe that answers counts the attempt").isOne();
        assertThat(soon.getNextAttemptAt()).isEqualTo(inTenMinutes);
        assertThat(lateRecording.effect()).isEqualTo(new PassEffect.Hold(NOW.plus(Duration.ofHours(1))));
        assertThat(late.getAttempts()).as("a probe that fails undoes the attempt").isZero();
        assertThat(late.getNextAttemptAt()).isEqualTo(NOW);
        assertThat(unstatedRecording.effect()).as("no stated time holds nothing; the backoff applies")
                .isEqualTo(new PassEffect.Continue());
        assertThat(unstated.getNextAttemptAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
    }

    @Test
    void givenRetryLaterForTheConnectorAtAPastTime_whenRecorded_thenTheWorkerIsNotHeld() {
        // given
        AccessGrant answering = fresh();
        SentCall answeringCall = decideAndBegin(answering, DEMAND, MAPPING, NOW);
        AccessGrant failing = fresh();
        SentCall failingCall = decideAndBegin(failing, DEMAND, MAPPING, NOW);
        GrantOutcome past = new GrantOutcome.RetryLater(Scope.CONNECTOR, NOW.minusSeconds(1), "429");

        // when
        Recording withProbe = answering.record(answeringCall, answered(past), PROBE_ANSWERS, NOW, DEADLINE);
        Recording withoutProbe = failing.record(failingCall, answered(past), PROBE_FAILS, NOW, DEADLINE);

        // then
        assertThat(withProbe.effect()).isEqualTo(new PassEffect.Continue());
        assertThat(withoutProbe.effect()).as("a failed probe is an outage, not a hold")
                .isEqualTo(new PassEffect.Outage());
    }

    @Test
    void givenRetryLaterForTheGrantAMonthAway_whenRecorded_thenItIsRetriedWithinAnHour() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        grant.record(call, answered(new GrantOutcome.RetryLater(Scope.GRANT, NOW.plus(Duration.ofDays(30)), "busy")),
                null, NOW, DEADLINE);

        // then
        assertThat(grant.getNextAttemptAt()).as("a stated time is capped at an hour")
                .isEqualTo(NOW.plus(Duration.ofHours(1)));
    }

    @Test
    void givenAnInstallWithoutAClearAnswer_whenTheReProbeFails_thenItIsNotCountedAndRetriedInAMinute() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        boolean probes = AccessGrant.needsReProbe(call.action(), unclear());
        Recording recording = grant.record(call, unclear(), PROBE_FAILS, NOW.plusSeconds(15), DEADLINE);

        // then
        assertThat(probes).isTrue();
        assertThat(recording.effect()).isEqualTo(OUTAGE);
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW.plusSeconds(15).plus(Duration.ofMinutes(1)));
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
    }

    @Test
    void givenAnInstallWithoutAClearAnswer_whenTheReProbeAnswers_thenItIsCountedWithBackoffAndThePassGoesOn() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        Recording recording = grant.record(call, unclear(), PROBE_ANSWERS, NOW.plusSeconds(15), DEADLINE);

        // then
        assertThat(recording.effect()).isEqualTo(CONTINUE);
        assertThat(grant.getAttempts()).isOne();
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getLastFailure()).isEqualTo("The access-control system gave no clear answer");
    }

    @Test
    void givenAClearAnswerForTheGrant_whenAskedForAReProbe_thenNoneIsNeeded() {
        // given
        CallResult accepted = answered(new GrantOutcome.Accepted("remote-user-1"));
        CallResult rejected = answered(new GrantOutcome.CodeRejected());
        CallResult refused = answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full"));

        // when / then
        assertThat(AccessGrant.needsReProbe(Action.GRANT, accepted)).isFalse();
        assertThat(AccessGrant.needsReProbe(Action.RESCHEDULE, rejected)).isFalse();
        assertThat(AccessGrant.needsReProbe(Action.REVOKE, refused)).isFalse();
    }

    @Test
    void givenAnAnswerThatNeedsAReProbe_whenRecordedWithoutOne_thenTheRecordingRefusesIt() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when / then
        assertThatThrownBy(() -> grant.record(call, unclear(), null, NOW, DEADLINE))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("This answer is recorded with the result of a fresh probe");
    }

    @Test
    void givenAnInstallWhoseCodeWasRejected_whenTheNextInstallIsAccepted_thenTheFailureAndTheCountsAreCleared() {
        // given
        AccessGrant grant = fresh();
        grant.record(decideAndBegin(grant, DEMAND, MAPPING, NOW), answered(new GrantOutcome.CodeRejected()), null,
                NOW, DEADLINE);
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        grant.record(call, answered(new GrantOutcome.Accepted("remote-user-1")), null, NOW, DEADLINE);

        // then
        assertThat(grant.getRejections()).isZero();
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getLastFailure()).isNull();
    }

    @Test
    void givenACallSentForAnotherGrant_whenRecorded_thenTheRecordingRefusesIt() {
        // given
        AccessGrant grant = fresh();
        decideAndBegin(grant, DEMAND, MAPPING, NOW);
        SentCall foreign = decideAndBegin(fresh(), DEMAND, MAPPING, NOW);

        // when / then
        assertThatThrownBy(() -> grant.record(foreign, answered(new GrantOutcome.Accepted("remote-user-1")), null,
                        NOW, DEADLINE))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("A call is recorded on the grant it was sent for");
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
    }

    @Test
    void givenALongReason_whenRecorded_thenItIsCutToWhatTheRowHolds() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "x".repeat(800))), null, NOW, DEADLINE);

        // then
        assertThat(grant.getLastFailure()).hasSize(500);
    }
}
