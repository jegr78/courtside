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
import static org.courtside.access.internal.Grants.SOUTH_GATE;
import static org.courtside.access.internal.Grants.answered;
import static org.courtside.access.internal.Grants.decideAndBegin;
import static org.courtside.access.internal.Grants.fresh;
import static org.courtside.access.internal.Grants.installed;
import static org.courtside.access.internal.Grants.unclear;

class AccessGrantDecisionTest {

    private static final Instant LATER = NOW.plus(Duration.ofHours(1));

    @Test
    void givenAFirstInstallTheSystemRefused_whenTheSameDemandIsDecidedAgain_thenWhatMayBeAtTheDoorIsRevoked() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);

        // when
        Action action = grant.decide(DEMAND, MAPPING, LATER);

        // then
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(action).as("a refused install may still have reached the door").isEqualTo(Action.REVOKE);
        assertThat(grant.isRefused()).isTrue();
    }

    @Test
    void givenARescheduleTheSystemRefusedAfterAMove_whenDecidedAgain_thenTheOldInstallationIsRevoked() {
        // given
        AccessGrant grant = installed();
        Demand moved = new Demand(DEMAND.validFrom(), DEMAND.validUntil(), Set.of(SOUTH_GATE));
        SentCall call = decideAndBegin(grant, moved, MAPPING, LATER);
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "group unknown")), null, LATER, DEADLINE);

        // when
        Action action = grant.decide(moved, MAPPING, LATER.plus(Duration.ofMinutes(1)));

        // then
        assertThat(action).as("the old window and door must not stay open").isEqualTo(Action.REVOKE);
    }

    @Test
    void givenARefusedGrantWhoseRevokeWasAccepted_whenTheSameDemandIsDecidedAgain_thenNoNewInstallFollows() {
        // given
        AccessGrant grant = fresh();
        grant.record(decideAndBegin(grant, DEMAND, MAPPING, NOW),
                answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);
        SentCall revoke = decideAndBegin(grant, DEMAND, MAPPING, LATER);
        grant.record(revoke, answered(new GrantOutcome.Accepted("remote-user-1")), null, LATER, DEADLINE);

        // when
        Action action = grant.decide(DEMAND, MAPPING, LATER.plus(Duration.ofHours(1)));

        // then
        assertThat(revoke.action()).isEqualTo(Action.REVOKE);
        assertThat(grant.getRemote()).isEqualTo(RemoteState.NONE);
        assertThat(grant.isRefused()).as("only a retry or a demand change installs again").isTrue();
        assertThat(action).isEqualTo(Action.NONE);
    }

    @Test
    void givenANewGrantWithDemand_whenDecided_thenItIsGrantedWithTheDemandAsWanted() {
        // given
        AccessGrant grant = fresh();

        // when
        Action action = grant.decide(DEMAND, MAPPING, NOW);

        // then
        assertThat(action).isEqualTo(Action.GRANT);
        assertThat(grant.isWanted()).isTrue();
        assertThat(grant.getWantFrom()).isEqualTo(DEMAND.validFrom());
        assertThat(grant.getWantUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(grant.getWantPoints()).containsExactly(NORTH_GATE);
        assertThat(grant.getWantMapping()).isEqualTo(MAPPING);
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW);
    }

    @Test
    void givenAnInstallWithoutAClearAnswer_whenItIsDueAgain_thenItIsGrantedAgain() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, unclear(), PROBE_ANSWERS, NOW, DEADLINE);

        // when
        Action action = grant.decide(DEMAND, MAPPING, LATER);

        // then
        assertThat(grant.getRemote()).isEqualTo(RemoteState.MAYBE);
        assertThat(action).isEqualTo(Action.GRANT);
    }

    @Test
    void givenAnInstalledGrant_whenItsWindowChanges_thenItIsRescheduled() {
        // given
        AccessGrant grant = installed();
        Demand moved = new Demand(DEMAND.validFrom().plus(Duration.ofHours(2)),
                DEMAND.validUntil().plus(Duration.ofHours(2)), DEMAND.accessPointIds());

        // when
        Action action = grant.decide(moved, MAPPING, LATER);

        // then
        assertThat(action).isEqualTo(Action.RESCHEDULE);
    }

    @Test
    void givenAnInstalledGrant_whenItsAccessPointsChange_thenItIsRescheduled() {
        // given
        AccessGrant grant = installed();
        Demand otherGate = new Demand(DEMAND.validFrom(), DEMAND.validUntil(), Set.of(SOUTH_GATE));

        // when
        Action action = grant.decide(otherGate, MAPPING, LATER);

        // then
        assertThat(action).isEqualTo(Action.RESCHEDULE);
    }

    @Test
    void givenAnInstalledGrant_whenTheConnectorsMappingChanges_thenItIsRescheduled() {
        // given
        AccessGrant grant = installed();

        // when
        Action action = grant.decide(DEMAND, "north-group-v2", LATER);

        // then
        assertThat(action).isEqualTo(Action.RESCHEDULE);
    }

    @Test
    void givenAnInstalledGrant_whenNothingChanges_thenNoCallIsMade() {
        // given
        AccessGrant grant = installed();

        // when
        Action action = grant.decide(DEMAND, MAPPING, LATER);

        // then
        assertThat(grant.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(action).isEqualTo(Action.NONE);
    }

    @Test
    void givenAnInstallWithoutAClearAnswer_whenTheBookingIsCancelled_thenItIsRevoked() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, unclear(), PROBE_ANSWERS, NOW, DEADLINE);

        // when
        Action action = grant.decide(null, null, NOW);

        // then
        assertThat(grant.isWanted()).isFalse();
        assertThat(action).as("an unclear install counts as applied").isEqualTo(Action.REVOKE);
    }

    @Test
    void givenAnInstalledGrant_whenTheBookingIsCancelled_thenItIsRevokedAtOnce() {
        // given
        AccessGrant grant = installed();

        // when
        Action action = grant.decide(null, null, NOW);

        // then
        assertThat(action).isEqualTo(Action.REVOKE);
        assertThat(grant.getWantFrom()).isNull();
        assertThat(grant.getWantPoints()).isEmpty();
    }

    @Test
    void givenANewGrantWithoutDemand_whenDecided_thenNoCallIsMadeAndTheRowIsNoLongerDue() {
        // given
        AccessGrant grant = fresh();

        // when
        Action action = grant.decide(null, null, NOW);

        // then
        assertThat(action).isEqualTo(Action.NONE);
        assertThat(grant.getNextAttemptAt()).as("a settled row leaves the pass's open rows").isNull();
    }

    @Test
    void givenAGrantInBackoff_whenTheSameDemandIsDecided_thenNoCallIsMadeYet() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, unclear(), PROBE_ANSWERS, NOW, DEADLINE);
        Instant backoffEnds = grant.getNextAttemptAt();

        // when
        Action action = grant.decide(DEMAND, MAPPING, NOW.plusSeconds(30));

        // then
        assertThat(action).isEqualTo(Action.NONE);
        assertThat(grant.getNextAttemptAt()).as("a recording's backoff is not undone by deciding again")
                .isEqualTo(backoffEnds).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        assertThat(grant.getAttempts()).isOne();
    }

    @Test
    void givenAGrantInBackoff_whenItsDemandChanges_thenItIsDueAtOnceWithAFreshCount() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, unclear(), PROBE_ANSWERS, NOW, DEADLINE);
        Instant soon = NOW.plusSeconds(30);

        // when
        Action action = grant.decide(new Demand(DEMAND.validFrom(), DEMAND.validUntil(), Set.of(SOUTH_GATE)),
                MAPPING, soon);

        // then
        assertThat(action).isEqualTo(Action.GRANT);
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getNextAttemptAt()).isEqualTo(soon);
    }

    @Test
    void givenADemandWhoseWindowHasEnded_whenDecided_thenItIsNotWanted() {
        // given
        AccessGrant installed = installed();
        AccessGrant neverSent = fresh();
        Instant afterTheWindow = DEMAND.validUntil();

        // when
        Action revoke = installed.decide(DEMAND, MAPPING, afterTheWindow);
        Action none = neverSent.decide(DEMAND, MAPPING, afterTheWindow);

        // then
        assertThat(installed.isWanted()).isFalse();
        assertThat(revoke).isEqualTo(Action.REVOKE);
        assertThat(none).isEqualTo(Action.NONE);
    }

    @Test
    void givenARefusedInstall_whenTheBookingIsCancelled_thenItIsStillRevoked() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);

        // when
        Action action = grant.decide(null, null, LATER);

        // then
        assertThat(action).isEqualTo(Action.REVOKE);
    }

    @Test
    void givenARefusedInstall_whenTheBoardRequestsARetry_thenTheRetryIsConsumedAndTheInstallIsDue() {
        // given
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);
        grant.requestRetry(NOW.plusSeconds(10));

        // when
        Action action = grant.decide(DEMAND, MAPPING, NOW.plusSeconds(20));

        // then
        assertThat(action).isEqualTo(Action.GRANT);
        assertThat(grant.isRefused()).isFalse();
        assertThat(grant.getAttempts()).isZero();
        assertThat(grant.getRetryRequestedAt()).as("a retry is consumed once").isNull();
    }

    @Test
    void givenAMappingTheConnectorCannotStore_whenDecided_thenTheDecisionRefusesIt() {
        // given
        AccessGrant grant = fresh();

        // when / then
        assertThatThrownBy(() -> grant.decide(DEMAND, "x".repeat(201), NOW))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The connector's mapping fingerprint has more than 200 characters");
        assertThatThrownBy(() -> grant.decide(DEMAND, null, NOW))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("A demand is decided with the connector's mapping fingerprint");
    }
}
