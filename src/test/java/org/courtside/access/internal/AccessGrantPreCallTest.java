package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.access.internal.Grants.CODE;
import static org.courtside.access.internal.Grants.DEADLINE;
import static org.courtside.access.internal.Grants.DEMAND;
import static org.courtside.access.internal.Grants.MAPPING;
import static org.courtside.access.internal.Grants.NORTH_GATE;
import static org.courtside.access.internal.Grants.NOW;
import static org.courtside.access.internal.Grants.PROBE_ANSWERS;
import static org.courtside.access.internal.Grants.decideAndBegin;
import static org.courtside.access.internal.Grants.fresh;
import static org.courtside.access.internal.Grants.installed;
import static org.courtside.access.internal.Grants.unclear;

class AccessGrantPreCallTest {

    @Test
    void givenAGrantToInstall_whenItsCallBegins_thenTheExposureAndTheAttemptAreCommittedBeforeTheCall() {
        // given
        AccessGrant grant = fresh();
        Action action = grant.decide(DEMAND, MAPPING, NOW);

        // when
        SentCall call = grant.beginCall(action, CODE, NOW);

        // then
        assertThat(grant.getRemote()).as("a call without an answer counts as applied").isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getExposedUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(grant.getLastInstallSentAt()).isEqualTo(NOW);
        assertThat(grant.getAttempts()).isOne();
        assertThat(grant.getNextAttemptAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
        assertThat(call.instruction().code()).isEqualTo(CODE);
        assertThat(call.instruction().validUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(call.instruction().accessPointIds()).containsExactly(NORTH_GATE);
        assertThat(call.mapping()).isEqualTo(MAPPING);
        assertThat(call.sentAt()).isEqualTo(NOW);
        assertThat(call.previousNextAttemptAt()).isEqualTo(NOW);
        assertThat(call.toString()).as("a receipt reaches logs, a door code must not").doesNotContain(CODE);
    }

    @Test
    void givenAnInstallThatExposedALongerWindow_whenAShorterOneIsSent_thenTheExposureIsNotLowered() {
        // given
        AccessGrant grant = installed();
        Demand shorter = new Demand(DEMAND.validFrom(), DEMAND.validUntil().minus(Duration.ofMinutes(30)),
                DEMAND.accessPointIds());
        Instant later = NOW.plus(Duration.ofHours(1));
        Action action = grant.decide(shorter, MAPPING, later);

        // when
        grant.beginCall(action, CODE, later);

        // then
        assertThat(action).isEqualTo(Action.RESCHEDULE);
        assertThat(grant.getExposedUntil()).as("a door may still accept the longer window").isEqualTo(DEMAND.validUntil());
        assertThat(grant.getRemote()).as("a reschedule without an answer may have been applied").isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getLastInstallSentAt()).isEqualTo(later);
    }

    @Test
    void givenAGrantToRevoke_whenItsCallBegins_thenOnlyTheAttemptIsCommitted() {
        // given
        AccessGrant grant = installed();
        Instant later = NOW.plus(Duration.ofHours(1));
        Action action = grant.decide(null, null, later);

        // when
        SentCall call = grant.beginCall(action, null, later);

        // then
        assertThat(grant.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grant.getExposedUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(grant.getLastInstallSentAt()).isEqualTo(NOW);
        assertThat(grant.getAttempts()).isOne();
        assertThat(call.reference().externalReference()).isEqualTo("remote-user-1");
    }

    @Test
    void givenCountedAttempts_whenEachBegins_thenTheBackoffGrowsAndStopsAtAnHour() {
        // given
        AccessGrant grant = fresh();
        Instant at = NOW;
        Demand allDay = new Demand(DEMAND.validFrom(), NOW.plus(Duration.ofDays(1)), DEMAND.accessPointIds());
        grant.decide(allDay, MAPPING, at);
        List<Duration> backoffs = new ArrayList<>();

        // when
        for (int attempt = 0; attempt < 6; attempt++) {
            SentCall call = grant.beginCall(Action.GRANT, CODE, at);
            backoffs.add(Duration.between(at, grant.getNextAttemptAt()));
            grant.record(call, unclear(), PROBE_ANSWERS, at, DEADLINE);
            at = grant.getNextAttemptAt();
            grant.decide(allDay, MAPPING, at);
        }

        // then
        assertThat(backoffs).containsExactly(Duration.ofMinutes(1), Duration.ofMinutes(5), Duration.ofMinutes(15),
                Duration.ofMinutes(60), Duration.ofMinutes(60), Duration.ofMinutes(60));
    }

    @Test
    void givenAnActionTheRowDoesNotCallFor_whenACallBegins_thenItIsRefused() {
        // given
        AccessGrant installed = installed();
        AccessGrant wanted = fresh();
        wanted.decide(DEMAND, MAPPING, NOW);

        // when / then
        assertThatThrownBy(() -> installed.beginCall(Action.REVOKE, null, NOW))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("A call begins only for the action the row is due for, not REVOKE");
        assertThatThrownBy(() -> wanted.beginCall(Action.GRANT, null, NOW))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("An install sends the grant's current code");
        assertThat(decideAndBegin(fresh(), DEMAND, MAPPING, NOW).action()).isEqualTo(Action.GRANT);
    }
}
