package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.access.AccessGrantQuery;
import org.courtside.access.BookingAccessGrant;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantStatus;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.access.internal.Grants.DEADLINE;
import static org.courtside.access.internal.Grants.DEMAND;
import static org.courtside.access.internal.Grants.MAPPING;
import static org.courtside.access.internal.Grants.NORTH_GATE;
import static org.courtside.access.internal.Grants.NOW;
import static org.courtside.access.internal.Grants.answered;

class AccessGrantTransitionsTest extends AbstractIntegrationTest {

    @Autowired
    private AccessGrantTransitions transitions;

    @Autowired
    private AccessGrantRepository grants;

    @Autowired
    private AccessGrantQuery query;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenAWantedGrantWithoutACode_whenItIsDecidedTwice_thenOneCodeIsDrawnAndKept() {
        // given
        UUID grant = storedGrant();

        // when
        Decision first = inRow(grant, row -> transitions.decide(row, DEMAND, MAPPING, NOW));
        Decision second = inRow(grant, row -> transitions.decide(row, DEMAND, MAPPING, NOW));

        // then
        assertThat(first.action()).isEqualTo(Action.GRANT);
        assertThat(first.code()).matches("[0-9]{6}");
        assertThat(second.code()).isEqualTo(first.code());
        assertThat(currentCodes()).containsExactly(first.code());
    }

    @Test
    void givenAGrantWithoutDemand_whenItIsDecided_thenNoCodeIsDrawn() {
        // given
        UUID grant = storedGrant();

        // when
        Decision decision = inRow(grant, row -> transitions.decide(row, null, null, NOW));

        // then
        assertThat(decision).isEqualTo(new Decision(Action.NONE, null));
        assertThat(currentCodes()).isEmpty();
    }

    @Test
    void givenAnInstallBeforeItsFirstAcceptance_whenTheCodeIsRejected_thenTheOldCodeIsHeldAndANewOneIsSentNextPass() {
        // given
        UUID grant = storedGrant();
        String rejectedCode = inRow(grant, row -> rejectOnce(row, NOW));

        // when
        SentCall next = inRow(grant, row -> {
            Decision decision = transitions.decide(row, DEMAND, MAPPING, NOW);
            return row.beginCall(decision.action(), decision.code(), NOW);
        });

        // then
        assertThat(next.instruction().code()).as("the next pass sends a freshly drawn code").isNotEqualTo(rejectedCode);
        assertThat(currentCodes()).containsExactly(next.instruction().code());
        assertThat(heldUntil(rejectedCode)).as("a door may accept the rejected code until its exposure ends")
                .isEqualTo(DEMAND.validUntil());
        assertThat(grants.findById(grant).orElseThrow().getRejections()).isOne();
    }

    @Test
    void givenAnInstallBeforeItsFirstAcceptance_whenItsCodeIsRejectedThreeTimes_thenTheGrantIsRefused() {
        // given
        UUID grant = storedGrant();
        inRow(grant, row -> rejectOnce(row, NOW));
        inRow(grant, row -> rejectOnce(row, NOW));

        // when
        inRow(grant, row -> rejectOnce(row, NOW));

        // then
        AccessGrant refused = grants.findById(grant).orElseThrow();
        assertThat(refused.isRefused()).isTrue();
        assertThat(refused.getRejections()).isEqualTo(3);
        assertThat(jdbc.sql("SELECT count(*) FROM access_code WHERE grant_id IS NULL").query(Integer.class).single())
                .as("every rejected code is held").isEqualTo(3);
        assertThat(currentCodes()).as("a retry finds a code to send").hasSize(1);
    }

    @Test
    void givenARefusedGrantInstalledAsWanted_whenDecided_thenNoCallIsMade() {
        // given
        UUID grant = storedRefusedInstalledGrant(DEMAND.validUntil());

        // when
        Decision decision = inRow(grant, row -> transitions.decide(row, DEMAND, MAPPING, NOW));

        // then
        assertThat(decision.action()).isEqualTo(Action.NONE);
    }

    @Test
    void givenARefusedGrantInstalledWithAnotherWindow_whenDecided_thenTheInstallationIsRevoked() {
        // given
        UUID grant = storedRefusedInstalledGrant(DEMAND.validUntil().plus(Duration.ofHours(2)));

        // when
        Decision decision = inRow(grant, row -> transitions.decide(row, DEMAND, MAPPING, NOW));

        // then
        assertThat(decision.action()).as("a refused grant leaves no broader installation at the door")
                .isEqualTo(Action.REVOKE);
    }

    private UUID storedRefusedInstalledGrant(Instant remoteUntil) {
        UUID grant = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO access_grant (id, booking_id, wanted, want_from, want_until, want_points,
                                                  want_mapping, remote, remote_from, remote_until, remote_points,
                                                  remote_mapping, exposed_until, refused, next_attempt_at)
                        VALUES (:id, :booking, true, :from, :until, ARRAY[:gate]::uuid[], :mapping, 'INSTALLED',
                                :from, :remoteUntil, ARRAY[:gate]::uuid[], :mapping, :remoteUntil, true, :due)
                        """)
                .param("id", grant).param("booking", UUID.randomUUID())
                .param("from", Timestamp.from(DEMAND.validFrom())).param("until", Timestamp.from(DEMAND.validUntil()))
                .param("remoteUntil", Timestamp.from(remoteUntil)).param("gate", NORTH_GATE)
                .param("mapping", MAPPING).param("due", Timestamp.from(NOW)).update();
        return grant;
    }

    @Test
    void givenAGrantAcceptedTwiceAndThenRefused_whenRecorded_thenEachTransitionIsStoredOnceAndNamesOnlyTheBooking() {
        // given
        UUID grant = storedGrant();
        UUID booking = grants.findById(grant).orElseThrow().getBookingId();

        // when
        inRow(grant, row -> answer(row, NOW, MAPPING, new GrantOutcome.Accepted("remote-user")));
        inRow(grant, row -> answer(row, NOW.plusSeconds(60), "north-group-v2", new GrantOutcome.Accepted("remote-user")));
        inRow(grant, row -> answer(row, NOW.plusSeconds(120), "north-group-v3",
                new GrantOutcome.Refused(Scope.GRANT, "keypad full")));

        // then
        assertThat(jdbc.sql("SELECT event_type FROM domain_event WHERE subject_id = ? ORDER BY occurred_at")
                .params(booking).query(String.class).list())
                .containsExactly("access.grant.installed", "access.grant.failing");
        assertThat(jdbc.sql("SELECT payload::text FROM domain_event WHERE subject_id = ?").params(booking)
                .query(String.class).list())
                .allSatisfy(payload -> assertThat(payload).isEqualTo("{\"bookingId\": \"" + booking + "\"}"));
    }

    @Test
    void givenAGrant_whenPlayersAskForIt_thenTheCodeIsOnlyNamedOnceADoorAcceptedItAndWhileItIsWanted() {
        // given
        UUID grant = storedGrant();
        UUID booking = grants.findById(grant).orElseThrow().getBookingId();
        SentCall call = inRow(grant, row -> {
            Decision decision = transitions.decide(row, DEMAND, MAPPING, NOW);
            return row.beginCall(decision.action(), decision.code(), NOW);
        });
        BookingAccessGrant beforeAcceptance = query.grantOf(booking).orElseThrow();

        // when
        inRow(grant, row -> transitions.record(row, call, answered(new GrantOutcome.Accepted("remote-user")), null,
                NOW, DEADLINE));
        BookingAccessGrant accepted = query.grantOf(booking).orElseThrow();
        inRow(grant, row -> transitions.decide(row, null, null, NOW));
        BookingAccessGrant cancelled = query.grantOf(booking).orElseThrow();

        // then
        assertThat(beforeAcceptance.code()).as("no door accepts it yet").isNull();
        assertThat(accepted.code()).isEqualTo(call.instruction().code());
        assertThat(accepted.status()).isEqualTo(GrantStatus.INSTALLED);
        assertThat(accepted.validUntil()).isEqualTo(DEMAND.validUntil());
        assertThat(cancelled.code()).as("a cancelled booking hands out no code").isNull();
        assertThat(cancelled.status()).isEqualTo(GrantStatus.REMOVING);
        assertThat(query.grantOf(UUID.randomUUID())).isEmpty();
    }

    private Recording answer(AccessGrant row, Instant at, String mapping, GrantOutcome outcome) {
        Decision decision = transitions.decide(row, DEMAND, mapping, at);
        SentCall call = row.beginCall(decision.action(), decision.code(), at);
        return transitions.record(row, call, answered(outcome), null, at, DEADLINE);
    }

    private String rejectOnce(AccessGrant row, Instant at) {
        Decision decision = transitions.decide(row, DEMAND, MAPPING, at);
        SentCall call = row.beginCall(decision.action(), decision.code(), at);
        transitions.record(row, call, answered(new GrantOutcome.CodeRejected()), null, at, DEADLINE);
        return decision.code();
    }

    private UUID storedGrant() {
        UUID grant = UUID.randomUUID();
        jdbc.sql("INSERT INTO access_grant (id, booking_id, next_attempt_at) VALUES (?, ?, ?)")
                .params(grant, UUID.randomUUID(), Timestamp.from(NOW)).update();
        return grant;
    }

    private <T> T inRow(UUID grant, Function<AccessGrant, T> work) {
        return new TransactionTemplate(transactions).execute(status -> work.apply(grants.findById(grant).orElseThrow()));
    }

    private List<String> currentCodes() {
        return jdbc.sql("SELECT code FROM access_code WHERE grant_id IS NOT NULL").query(String.class).list();
    }

    private Instant heldUntil(String code) {
        OffsetDateTime until = jdbc.sql("SELECT until FROM access_code WHERE code = ? AND grant_id IS NULL")
                .params(code).query((row, index) -> row.getObject(1, OffsetDateTime.class)).list().getFirst();
        return until == null ? null : until.toInstant();
    }
}
