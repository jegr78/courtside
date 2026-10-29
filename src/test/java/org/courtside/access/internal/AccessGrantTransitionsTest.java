package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.access.GrantOutcome;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.access.internal.Grants.DEADLINE;
import static org.courtside.access.internal.Grants.DEMAND;
import static org.courtside.access.internal.Grants.MAPPING;
import static org.courtside.access.internal.Grants.NOW;
import static org.courtside.access.internal.Grants.answered;

class AccessGrantTransitionsTest extends AbstractIntegrationTest {

    @Autowired
    private AccessGrantTransitions transitions;

    @Autowired
    private AccessGrantRepository grants;

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

    private String rejectOnce(AccessGrant row, Instant at) {
        Decision decision = transitions.decide(row, DEMAND, MAPPING, at);
        SentCall call = row.beginCall(decision.action(), decision.code(), at);
        transitions.record(row, call, answered(new GrantOutcome.CodeRejected()), null, at, DEADLINE);
        return decision.code();
    }

    private UUID storedGrant() {
        return new TransactionTemplate(transactions).execute(status ->
                grants.saveAndFlush(AccessGrant.open(UUID.randomUUID(), NOW)).getId());
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
