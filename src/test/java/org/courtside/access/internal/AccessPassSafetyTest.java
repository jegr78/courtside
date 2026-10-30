package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class AccessPassSafetyTest extends AccessPassTestSupport {

    private static final Step ACCEPT_LATER = new Step.Answer(new GrantOutcome.Accepted("remote-user"));

    @Test
    void givenAConnectorThatThrowsAnErrorAfterThePreCallCommit_whenThePassRuns_thenTheGrantCountsAsExposed() {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(new Step.Fail(new AssertionError("connector crashed")));

        // when
        pass.runPassNow();

        // then
        AccessGrant grant = grantOf(booking);
        assertThat(grant.getRemote()).as("a call without an answer counts as applied").isEqualTo(RemoteState.MAYBE);
        assertThat(grant.getExposedUntil()).isEqualTo(VALID_UNTIL);
        assertThat(currentCode(booking)).as("the code a door may accept stays held").isPresent();
    }

    @Test
    void givenAnInstallWhoseRecordingIsLost_whenTheBookingIsCancelled_thenTheNextPassRevokesIt() throws Exception {
        // given
        UUID booking = book(courts.get(0));
        CountDownLatch rowLocked = new CountDownLatch(1);
        CompletableFuture<Void> blocker = new CompletableFuture<>();
        connector.nextInstalls(new Step.Then(() -> {
            UUID grantId = grantIdOf(booking);
            blocker.completeAsync(() -> {
                holdRowLock(grantId, rowLocked);
                return null;
            });
            await(rowLocked);
        }, ACCEPT_LATER));

        // when
        pass.runPassNow();
        blocker.get(10, TimeUnit.SECONDS);
        AccessGrant afterTheLostAnswer = grantOf(booking);
        cancel(booking);
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(afterTheLostAnswer.getRemote()).as("the pre-call state survives a lost recording")
                .isEqualTo(RemoteState.MAYBE);
        assertThat(connector.calls(Kind.REVOKE)).extracting(ScriptedAccessControl.Call::grantId)
                .containsExactly(grantIdOf(booking));
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenAnInstallWithoutAClearAnswer_whenTheBookingIsCancelled_thenARevokeFollowsAndTheCodeStaysHeld() {
        // given
        UUID booking = book(courts.get(0));
        connector.nextInstalls(new Step.Hang());
        pass.runPassNow();
        cancel(booking);

        // when
        passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(connector.calls(Kind.REVOKE)).hasSize(1);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.NONE);
        assertThat(currentCode(booking)).as("a door may accept the code until its exposure ends").isPresent();
    }

    @Test
    void givenARevokeAcceptedWithinTwoDeadlinesOfTheInstall_whenTheBoundPasses_thenOneMoreRevokeIsSent() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        cancel(booking);

        // when
        passAt(START.plus(DEADLINE));
        AccessGrant early = grantOf(booking);
        passAt(START.plus(DEADLINE).plusMillis(100));
        passAt(START.plus(DEADLINE.multipliedBy(2)));

        // then
        assertThat(early.getRemote()).as("an abandoned install may still be processed").isEqualTo(RemoteState.MAYBE);
        assertThat(early.getNextAttemptAt()).isEqualTo(START.plus(DEADLINE.multipliedBy(2)));
        assertThat(connector.calls(Kind.REVOKE)).hasSize(2);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenARevokedGrant_whenItsExposureEnds_thenItsCodeIsReleasedAndDeleted() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        cancel(booking);
        passAt(START.plus(Duration.ofMinutes(1)));
        boolean heldBeforeTheEnd = currentCode(booking).isPresent();

        // when
        passAt(VALID_UNTIL.minusSeconds(1));
        boolean heldJustBefore = currentCode(booking).isPresent();
        passAt(VALID_UNTIL);

        // then
        assertThat(heldBeforeTheEnd).isTrue();
        assertThat(heldJustBefore).isTrue();
        assertThat(accessCodes()).as("no door accepts the code any more").isZero();
        assertThat(grantOf(booking).getFirstAcceptedAt()).isNull();
    }

    @Test
    void givenARevokeTheSystemKeepsRefusing_whenTheExposureHasLongEnded_thenItIsStillRetriedAndTheCodeKept() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        cancel(booking);
        connector.everyRevoke(new Step.Answer(new GrantOutcome.Refused(Scope.GRANT, "user locked")));

        // when
        Instant at = START.plus(Duration.ofMinutes(1));
        Instant lastPass = at;
        for (int pass = 0; pass < 11; pass++) {
            lastPass = at;
            passAt(at);
            at = grantOf(booking).getNextAttemptAt();
        }

        // then
        assertThat(lastPass).as("a pass ran after the exposure ended").isAfter(VALID_UNTIL);
        assertThat(connector.calls(Kind.REVOKE)).hasSize(11);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(currentCode(booking)).as("a code is never released while it may be installed").isPresent();
    }

    @Test
    void givenARevokeThatStaysUnclearWhileTheProbeAnswers_whenItIsRetried_thenEveryAttemptIsCounted() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        cancel(booking);
        connector.everyRevoke(new Step.Fail(new IllegalStateException("socket reset")));

        // when
        Instant at = START.plus(Duration.ofMinutes(1));
        for (int pass = 0; pass < 5; pass++) {
            passAt(at);
            at = grantOf(booking).getNextAttemptAt();
        }

        // then
        assertThat(grantOf(booking).getAttempts()).isEqualTo(5);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    private void holdRowLock(UUID grantId, CountDownLatch locked) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            jdbc.sql("SELECT id FROM access_grant WHERE id = ? FOR UPDATE").params(grantId).query().listOfRows();
            locked.countDown();
            try {
                Thread.sleep(Duration.ofSeconds(2));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("The second session never locked the grant row");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }
}
