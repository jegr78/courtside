package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.Scope;
import org.courtside.access.internal.ScriptedAccessControl.Call;
import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.access.internal.ScriptedAccessControl.Step;
import org.courtside.identity.Role;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(RulesTestFixture.class)
class AccessPassDemandTest extends AccessPassTestSupport {

    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant LATER = START.plus(Duration.ofMinutes(1));

    @Autowired
    private RulesTestFixture rules;

    @Test
    void givenAConfirmedBookingBehindADynamicGate_whenThePassRuns_thenItsGrantIsInstalledForItsWindow() {
        // given
        UUID booking = book(courts.get(0));

        // when
        pass.runPassNow();

        // then
        Call grant = connector.calls(Kind.GRANT).getFirst();
        assertThat(grant.code()).matches("[0-9]{6}");
        AccessGrant installed = grantOf(booking);
        assertThat(installed.getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(installed.getRemoteFrom()).isEqualTo(Instant.parse("2026-05-12T15:45:00Z"));
        assertThat(installed.getRemoteUntil()).isEqualTo(VALID_UNTIL);
        assertThat(installed.getRemotePoints()).containsExactly(northGate);
    }

    @Test
    void givenABookingCancelledAfterThePassReadItsRows_whenItsRowIsVisited_thenItIsRevokedInThatPass() {
        // given
        UUID pending = book(courts.get(0));
        UUID cancelled = book(courts.get(1));
        pass.runPassNow();
        cancel(pending);
        connector.nextRevokes(new Step.Answer(new GrantOutcome.Refused(Scope.GRANT, "user locked")));
        passAt(LATER);
        connector.nextRevokes(new Step.Then(() -> cancel(cancelled),
                new Step.Answer(new GrantOutcome.Accepted("remote-user"))));

        // when
        passAt(LATER.plus(Duration.ofMinutes(1)));

        // then
        assertThat(connector.calls(Kind.REVOKE)).extracting(Call::grantId)
                .as("the pending revoke runs first and cancels the other booking during its call")
                .containsExactly(grantIdOf(pending), grantIdOf(pending), grantIdOf(cancelled));
        assertThat(grantOf(cancelled).getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenAnInstalledSeriesOccurrence_whenTheSeriesMovesToAnotherTime_thenItIsRescheduledWithTheSameCode() {
        // given
        UUID series = series(courts.get(0), 1);
        pass.runPassNow();

        // when
        bookings.moveWholeSeries(series, LocalTime.of(18, 0), account(), Set.of(Role.ADMIN));
        passAt(LATER);

        // then
        Call reschedule = connector.calls(Kind.RESCHEDULE).getFirst();
        assertThat(reschedule.code()).as("a move keeps the code").isEqualTo(connector.calls(Kind.GRANT).getFirst().code());
        assertThat(grantOf(bookings.firstOccurrenceOf(series)).getRemoteFrom())
                .as("18:00 in the club's time zone, fifteen minutes ahead").isEqualTo(Instant.parse("2026-05-12T15:45:00Z"));
    }

    @Test
    void givenAnInstalledSeriesOccurrence_whenItMovesToACourtBehindAnotherGate_thenItIsRescheduledThere() {
        // given
        UUID series = series(courts.get(0), 1);
        pass.runPassNow();

        // when
        bookings.moveWholeSeriesToCourt(series, courts.get(1), account(), Set.of(Role.ADMIN));
        passAt(LATER);

        // then
        assertThat(connector.calls(Kind.RESCHEDULE)).hasSize(1);
        assertThat(connector.calls(Kind.RESCHEDULE).getFirst().code())
                .isEqualTo(connector.calls(Kind.GRANT).getFirst().code());
        assertThat(grantOf(bookings.firstOccurrenceOf(series)).getRemotePoints()).containsExactly(southGate);
    }

    @Test
    void givenAnInstalledSeriesOccurrence_whenItMovesToACourtWithoutAGate_thenItIsRevoked() {
        // given
        UUID openCourt = facility.createCourt(3, "Court 3");
        UUID series = series(courts.get(0), 1);
        pass.runPassNow();

        // when
        bookings.moveWholeSeriesToCourt(series, openCourt, account(), Set.of(Role.ADMIN));
        passAt(LATER);

        // then
        assertThat(connector.calls(Kind.REVOKE)).hasSize(1);
        assertThat(grantOf(bookings.firstOccurrenceOf(series)).getRemote()).isEqualTo(RemoteState.NONE);
    }

    @Test
    void givenACardSwitchedOffBeforeTheFirstInstall_whenItIsSwitchedOnAgain_thenTheGrantReopensAndInstalls() {
        // given
        UUID booking = book(courts.get(0));
        insertWithoutCalls();
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, false);
        pass.runPassNow();
        boolean calledWhileOff = !connector.calls(Kind.GRANT).isEmpty();
        boolean codeWhileOff = currentCode(booking).isPresent();

        // when
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        passAt(LATER);

        // then
        assertThat(calledWhileOff).isFalse();
        assertThat(codeWhileOff).isFalse();
        assertThat(connector.calls(Kind.GRANT)).hasSize(1);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(currentCode(booking)).hasValue(connector.calls(Kind.GRANT).getFirst().code());
    }

    @Test
    void givenAStaticCodeOnTheOnlyGate_whenItIsSetAndClearedAgain_thenTheGrantIsRevokedAndInstalledAgain() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();

        // when
        facility.changeAccessPoint(northGate, "North gate", courts.subList(0, 1), "246810");
        passAt(LATER);
        RemoteState withTheStaticCode = grantOf(booking).getRemote();
        facility.changeAccessPoint(northGate, "North gate", courts.subList(0, 1), null);
        passAt(LATER.plus(Duration.ofMinutes(1)));

        // then
        assertThat(connector.calls(Kind.REVOKE)).hasSize(1);
        assertThat(withTheStaticCode).isEqualTo(RemoteState.NONE);
        assertThat(connector.calls(Kind.GRANT)).hasSize(2);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenABookingBehindTwoGates_whenOneGetsAStaticCode_thenTheGrantIsRescheduledWithTheOther() {
        // given
        UUID booking = bookingOnBothCourts();
        pass.runPassNow();
        Set<UUID> before = grantOf(booking).getRemotePoints();

        // when
        facility.changeAccessPoint(southGate, "South gate", courts.subList(1, 2), "246810");
        passAt(LATER);

        // then
        assertThat(before).containsExactlyInAnyOrder(northGate, southGate);
        assertThat(connector.calls(Kind.RESCHEDULE)).hasSize(1);
        assertThat(grantOf(booking).getRemotePoints()).containsExactly(northGate);
    }

    @Test
    void givenAnInstalledGrant_whenItsGateIsDeactivatedAndReactivated_thenItIsRevokedAndInstalledAgain() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();

        // when
        facility.deactivateAccessPoint(northGate);
        passAt(LATER);
        RemoteState whileInactive = grantOf(booking).getRemote();
        facility.activateAccessPoint(northGate);
        passAt(LATER.plus(Duration.ofMinutes(1)));

        // then
        assertThat(whileInactive).isEqualTo(RemoteState.NONE);
        assertThat(connector.calls(Kind.GRANT)).hasSize(2);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenAnInstalledGrant_whenTheConnectorsMappingChanges_thenItIsRescheduled() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();

        // when
        connector.mapping(points -> "mapping-v2");
        passAt(LATER);

        // then
        assertThat(connector.calls(Kind.RESCHEDULE)).hasSize(1);
        assertThat(grantOf(booking).getRemoteMapping()).isEqualTo("mapping-v2");
    }

    @Test
    void givenAnInstalledGrant_whenTheBookingHorizonShrinks_thenTheGrantStays() {
        // given
        UUID booking = book(courts.get(0), new TimeSlot(EVENING.start().plus(Duration.ofDays(1)),
                EVENING.end().plus(Duration.ofDays(1))));
        pass.runPassNow();

        // when
        rules.letEveryoneBookDaysAhead(1);
        passAt(LATER);

        // then
        assertThat(connector.calls(Kind.REVOKE)).as("the horizon only decides when a row is inserted").isEmpty();
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenABookingBeyondTheHorizon_whenItsStartEntersIt_thenItsGrantIsInsertedAndInstalled() {
        // given
        UUID booking = book(courts.get(0), new TimeSlot(EVENING.start().plus(Duration.ofDays(1)),
                EVENING.end().plus(Duration.ofDays(1))));
        rules.letEveryoneBookDaysAhead(1);
        pass.runPassNow();
        int rowsBefore = grantRows();

        // when
        passAt(Instant.parse("2026-05-13T08:00:00Z"));

        // then
        assertThat(rowsBefore).isZero();
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenAGrantNeverInstalled_whenItsWindowHasEnded_thenNothingIsSentAndTheRowSettles() {
        // given
        UUID booking = book(courts.get(0));
        insertWithoutCalls();

        // when
        passAt(VALID_UNTIL);

        // then
        assertThat(connector.calls()).extracting(Call::kind).containsExactly(Kind.PROBE);
        assertThat(grantOf(booking).isWanted()).isFalse();
        assertThat(grantOf(booking).getNextAttemptAt()).isNull();
    }

    @Test
    void givenAnInstalledGrant_whenItsBookingIsDisplacedByAClosure_thenTheGrantIsLeftAsItIs() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();

        // when
        facility.closeCourt(courts.get(0), LocalDate.of(2026, 5, 12), LocalDate.of(2026, 5, 12));
        passAt(LATER);

        // then
        assertThat(bookings.isConfirmed(booking)).as("a displaced booking stays until the club cancels it").isTrue();
        assertThat(connector.calls(Kind.REVOKE)).isEmpty();
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
    }

    @Test
    void givenAWeeklySeries_whenItsOccurrencesEnterTheHorizon_thenEachIsInsertedInTurn() {
        // given
        series(courts.get(0), 3);

        // when
        pass.runPassNow();
        int firstWeek = grantRows();
        passAt(Instant.parse("2026-05-19T08:00:00Z"));
        int secondWeek = grantRows();

        // then
        assertThat(firstWeek).isOne();
        assertThat(secondWeek).isEqualTo(2);
    }

    private UUID series(UUID court, int occurrences) {
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        return bookings.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 12), LocalTime.of(16, 0), 60,
                occurrences, account(), person(), Set.of(Role.ADMIN));
    }

    private UUID bookingOnBothCourts() {
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        return bookings.createBookingOnCourts(courts, TRAINING_CARD, EVENING, person(), Set.of(Role.ADMIN));
    }

    private int grantRows() {
        return jdbc.sql("SELECT count(*) FROM access_grant").query(Integer.class).single();
    }
}
