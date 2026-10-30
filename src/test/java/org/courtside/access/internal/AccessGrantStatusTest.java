package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantStatus;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.access.internal.Grants.DEADLINE;
import static org.courtside.access.internal.Grants.DEMAND;
import static org.courtside.access.internal.Grants.MAPPING;
import static org.courtside.access.internal.Grants.NOW;
import static org.courtside.access.internal.Grants.PROBE_ANSWERS;
import static org.courtside.access.internal.Grants.SOUTH_GATE;
import static org.courtside.access.internal.Grants.answered;
import static org.courtside.access.internal.Grants.decideAndBegin;
import static org.courtside.access.internal.Grants.fresh;
import static org.courtside.access.internal.Grants.installed;
import static org.courtside.access.internal.Grants.unclear;

class AccessGrantStatusTest {

    private static final Instant LATER = NOW.plus(Duration.ofHours(1));

    @Test
    void givenGrantsInEachState_whenTheirStatusIsRead_thenEachShowsItsLabel() {
        // given
        AccessGrant waiting = fresh();
        waiting.decide(DEMAND, MAPPING, NOW);
        AccessGrant installed = installed();
        AccessGrant moved = installed();
        moved.decide(new Demand(DEMAND.validFrom(), DEMAND.validUntil(), Set.of(SOUTH_GATE)), MAPPING, LATER);
        AccessGrant removing = installed();
        removing.decide(null, null, LATER);
        AccessGrant done = fresh();
        done.decide(null, null, NOW);

        // when / then
        assertThat(waiting.status()).isEqualTo(GrantStatus.WAITING);
        assertThat(installed.status()).isEqualTo(GrantStatus.INSTALLED);
        assertThat(moved.status()).as("installed, but not as now wanted").isEqualTo(GrantStatus.WAITING);
        assertThat(removing.status()).isEqualTo(GrantStatus.REMOVING);
        assertThat(done.status()).isEqualTo(GrantStatus.DONE);
    }

    @Test
    void givenARefusedGrantOrOneWithFiveCountedAttempts_whenItsStatusIsRead_thenFailingComesFirst() {
        // given
        AccessGrant refused = fresh();
        refused.record(decideAndBegin(refused, DEMAND, MAPPING, NOW),
                answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);
        AccessGrant stuckRemoving = installed();
        Instant at = LATER;
        stuckRemoving.decide(null, null, at);
        for (int attempt = 0; attempt < 5; attempt++) {
            stuckRemoving.record(stuckRemoving.beginCall(Action.REVOKE, null, at), unclear(), PROBE_ANSWERS, at,
                    DEADLINE);
            at = stuckRemoving.getNextAttemptAt();
            stuckRemoving.decide(null, null, at);
        }

        // when / then
        assertThat(refused.status()).isEqualTo(GrantStatus.FAILING);
        assertThat(stuckRemoving.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(stuckRemoving.status()).as("failing outranks removing").isEqualTo(GrantStatus.FAILING);
    }

    @Test
    void givenAGrantAcceptedTwice_whenEachAnswerIsRecorded_thenOnlyTheFirstReportsTheCodeAsAccepted() {
        // given
        AccessGrant grant = fresh();
        SentCall first = decideAndBegin(grant, DEMAND, MAPPING, NOW);

        // when
        Recording firstAnswer = grant.record(first, answered(new GrantOutcome.Accepted("remote-user")), null, NOW,
                DEADLINE);
        Recording secondAnswer = grant.record(decideAndBegin(grant, DEMAND, "north-group-v2", LATER),
                answered(new GrantOutcome.Accepted("remote-user")), null, LATER, DEADLINE);

        // then
        assertThat(firstAnswer.firstAccepted()).isTrue();
        assertThat(secondAnswer.firstAccepted()).as("a move is no new acceptance of the code").isFalse();
    }

    @Test
    void givenAttemptsThatStayUnclear_whenTheFifthIsCounted_thenOnlyThatOneReportsTheGrantAsFailing() {
        // given
        AccessGrant grant = fresh();
        Instant at = NOW;
        Demand allDay = new Demand(DEMAND.validFrom(), NOW.plus(Duration.ofDays(1)), DEMAND.accessPointIds());

        // when
        StringBuilder failing = new StringBuilder();
        for (int attempt = 0; attempt < 6; attempt++) {
            Recording recording = grant.record(decideAndBegin(grant, allDay, MAPPING, at), unclear(), PROBE_ANSWERS,
                    at, DEADLINE);
            failing.append(recording.becameFailing() ? 'F' : '.');
            at = grant.getNextAttemptAt();
        }

        // then
        assertThat(failing.toString()).as("the transition is reported once").isEqualTo("....F.");
    }

    @Test
    void givenAnInstallRefusedOrRejectedThreeTimes_whenRecorded_thenTheRefusalReportsTheGrantAsFailingOnce() {
        // given
        AccessGrant refused = fresh();
        AccessGrant rejected = fresh();

        // when
        Recording refusal = refused.record(decideAndBegin(refused, DEMAND, MAPPING, NOW),
                answered(new GrantOutcome.Refused(Scope.GRANT, "keypad full")), null, NOW, DEADLINE);
        StringBuilder rejections = new StringBuilder();
        for (int attempt = 0; attempt < 3; attempt++) {
            rejections.append(rejected.record(decideAndBegin(rejected, DEMAND, MAPPING, NOW),
                    answered(new GrantOutcome.CodeRejected()), null, NOW, DEADLINE).becameFailing() ? 'F' : '.');
        }

        // then
        assertThat(refusal.becameFailing()).isTrue();
        assertThat(rejections.toString()).isEqualTo("..F");
    }
}
