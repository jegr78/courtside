package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class AccessPassMechanicsTest extends AccessPassTestSupport {

    @Test
    void givenACodeRejectedBeforeItsFirstAcceptance_whenThePassGoesOn_thenTheRowIsNotVisitedTwiceInOnePass() {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(new Step.Answer(new GrantOutcome.CodeRejected()));

        // when
        pass.runPassNow();
        int callsInTheFirstPass = connector.calls(Kind.GRANT).size();
        pass.runPassNow();

        // then
        assertThat(callsInTheFirstPass).as("a row is visited at most once per pass").isOne();
        assertThat(connector.calls(Kind.GRANT)).hasSize(2);
        assertThat(connector.calls(Kind.GRANT).get(1).code()).isNotEqualTo(connector.calls(Kind.GRANT).get(0).code());
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenAKnownRevocationAndANewInstall_whenTheInstallEndsThePassAsAnOutage_thenTheRevocationWasSentFirst() {
        // given
        UUID cancelled = book(courts.get(0));
        pass.runPassNow();
        cancel(cancelled);
        connector.nextRevokes(new Step.Answer(new GrantOutcome.Refused(Scope.GRANT, "user locked")));
        passAt(START.plus(Duration.ofMinutes(1)));
        book(courts.get(1));
        connector.nextInstalls(new Step.Answer(new GrantOutcome.Refused(Scope.CONNECTOR, "403 no user management")));
        connector.nextProbes(new Step.Probe(new ProbeOutcome.Answered()),
                new Step.Probe(new ProbeOutcome.Refused("403 no user management")));
        int callsBefore = connector.calls().size();

        // when
        PassResult result = passAt(START.plus(Duration.ofMinutes(2)));

        // then
        assertThat(result).isEqualTo(new PassResult.Outage());
        assertThat(connector.calls().subList(callsBefore, connector.calls().size()))
                .extracting(ScriptedAccessControl.Call::kind)
                .as("a revocation never waits behind an install")
                .containsExactly(Kind.PROBE, Kind.REVOKE, Kind.GRANT, Kind.PROBE);
        assertThat(grantOf(cancelled).getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenMoreBookingsThanOneInsertPage_whenThePassInsertsThem_thenEveryBookingGetsItsGrant() {
        // given
        book(courts.get(0));
        book(courts.get(1));
        book(courts.get(0), new TimeSlot(EVENING.end(), EVENING.end().plus(Duration.ofHours(1))));

        // when
        pass.runPassNow();

        // then
        assertThat(jdbc.sql("SELECT count(*) FROM access_grant WHERE remote = 'INSTALLED'").query(Integer.class)
                .single()).isEqualTo(3);
    }

    @Test
    void givenARowTransaction_whileItDecides_thenNoOtherWriterCanLockTheRow() {
        // given
        UUID booking = book(courts.get(0));
        insertWithoutCalls();
        UUID grantId = grantIdOf(booking);
        AtomicReference<Boolean> otherWriterGotTheLock = new AtomicReference<>();
        connector.whileMapping(points -> otherWriterGotTheLock.compareAndSet(null, CompletableFuture.supplyAsync(
                () -> tryLockWithoutWaiting(grantId)).join()));

        // when
        pass.runPassNow();

        // then
        assertThat(otherWriterGotTheLock.get()).as("a row transaction reads its row FOR UPDATE").isFalse();
    }

    @Test
    void givenARetryRequestedWhileARowTransactionHoldsTheRow_whenThePassesRun_thenItIsAppliedAfterAndConsumedOnce()
            throws Exception {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        UUID grantId = grantIdOf(booking);
        AtomicBoolean requested = new AtomicBoolean();
        CompletableFuture<Void> retry = new CompletableFuture<>();
        connector.whileMapping(points -> {
            if (requested.compareAndSet(false, true)) {
                retry.completeAsync(() -> {
                    inLockedRow(grantId, row -> row.requestRetry(START.plusSeconds(30)));
                    return null;
                });
            }
        });

        // when
        passAt(START.plusSeconds(30));
        retry.get(10, TimeUnit.SECONDS);
        AccessGrant afterTheRowTransaction = grantOf(booking);
        connector.whileMapping(points -> { });
        passAt(START.plusSeconds(60));

        // then
        assertThat(afterTheRowTransaction.getRetryRequestedAt()).as("a retry arriving meanwhile is not lost")
                .isEqualTo(START.plusSeconds(30));
        assertThat(grantOf(booking).getRetryRequestedAt()).as("the next decision consumes it").isNull();
    }

    @Test
    void givenAPassClockPastTheWindow_whenThePassRuns_thenItComparesAgainstThatClockAndNotTheApplications() {
        // given
        UUID installed = book(courts.get(0));
        pass.runPassNow();
        UUID late = book(courts.get(1));

        // when
        passAt(VALID_UNTIL);

        // then
        assertThat(connector.calls(Kind.REVOKE)).extracting(ScriptedAccessControl.Call::grantId)
                .as("the window has ended by the pass clock").containsExactly(grantIdOf(installed));
        assertThat(jdbc.sql("SELECT count(*) FROM access_grant WHERE booking_id = ?").params(late)
                .query(Integer.class).single()).as("a booking whose window has ended is never inserted").isZero();
    }

    private boolean tryLockWithoutWaiting(UUID grantId) {
        try {
            new TransactionTemplate(transactions).executeWithoutResult(status ->
                    jdbc.sql("SELECT id FROM access_grant WHERE id = ? FOR UPDATE NOWAIT").params(grantId)
                            .query().listOfRows());
            return true;
        } catch (DataAccessException locked) {
            return false;
        }
    }
}
