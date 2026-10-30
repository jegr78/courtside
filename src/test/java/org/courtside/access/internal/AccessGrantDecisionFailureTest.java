package org.courtside.access.internal;

import org.courtside.access.GrantStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Timestamp;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AccessGrantDecisionFailureTest extends AccessPassTestSupport {

    @Autowired
    private AccessGrantAdministration administration;

    @Test
    void givenAMappingThatThrows_whenThePassDecidesTheGrant_thenTheFailureIsRecordedCountedAndShown() {
        // given
        UUID booking = book(courts.get(0));
        connector.mapping(points -> {
            throw new IllegalStateException("group lookup failed");
        });

        // when
        pass.runPassNow();

        // then
        AccessGrant grant = grantOf(booking);
        assertThat(grant.getAttempts()).as("the failed decision counts").isOne();
        assertThat(grant.getNextAttemptAt()).as("with backoff").isEqualTo(START.plus(Duration.ofMinutes(1)));
        assertThat(grant.getLastFailure()).contains("group lookup failed");
        List<AccessGrantAdministration.GrantView> shown = administration.overview().grants();
        assertThat(shown).extracting(AccessGrantAdministration.GrantView::bookingId)
                .as("a grant that cannot be decided is not hidden").containsExactly(booking);
        assertThat(shown.getFirst().status()).isEqualTo(GrantStatus.WAITING);
        assertThat(connector.calls()).as("nothing is sent for a grant that cannot be decided").isEmpty();
    }

    @Test
    void givenADecisionThatKeepsFailing_whenItIsRetriedEachTimeItIsDue_thenTheFifthAttemptMakesItFailingOnce() {
        // given
        UUID booking = book(courts.get(0));
        connector.mapping(points -> {
            throw new IllegalStateException("group lookup failed");
        });

        // when
        for (int minute : new int[] {0, 1, 2, 6, 7, 21, 22, 81, 82}) {
            passAt(START.plus(Duration.ofMinutes(minute)));
        }

        // then
        assertThat(grantOf(booking).getAttempts()).as("counted only when due, not on every pass").isEqualTo(5);
        assertThat(grantOf(booking).status()).isEqualTo(GrantStatus.FAILING);
        assertThat(jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'access.grant.failing'"
                + " AND subject_id = ?").params(booking).query(Integer.class).single()).isOne();
    }

    @Test
    void givenAMappingThatIsMissingOrTooLong_whenThePassDecidesTheGrants_thenEachFailureIsRecorded() {
        // given
        UUID missing = book(courts.get(0));
        UUID tooLong = book(courts.get(1));
        connector.mapping(points -> points.contains(northGate) ? null : "m".repeat(201));

        // when
        pass.runPassNow();

        // then
        assertThat(grantOf(missing).getLastFailure()).as("no mapping").isNotBlank();
        assertThat(grantOf(missing).getAttempts()).isOne();
        assertThat(grantOf(tooLong).getLastFailure()).as("a mapping beyond 200 characters").isNotBlank();
        assertThat(grantOf(tooLong).getAttempts()).isOne();
    }

    @Test
    void givenNoFreeCodeOfTheClubsLength_whenThePassDrawsOne_thenTheFailureIsRecordedOnTheGrant() {
        // given
        jdbc.sql("UPDATE club_config SET access_code_length = 4").update();
        jdbc.sql("INSERT INTO access_code (code, until) SELECT lpad(n::text, 4, '0'), :until"
                + " FROM generate_series(0, 9999) AS n")
                .param("until", Timestamp.from(START.plus(Duration.ofDays(1)))).update();
        UUID booking = book(courts.get(0));

        // when
        pass.runPassNow();

        // then
        assertThat(grantOf(booking).getAttempts()).as("the failed draw counts").isOne();
        assertThat(grantOf(booking).getLastFailure()).isNotBlank();
        assertThat(currentCode(booking)).isEmpty();
    }

    @Test
    void givenADecisionThatFailedOnce_whenTheNextPassDecidesIt_thenTheGrantIsInstalled() {
        // given
        UUID booking = book(courts.get(0));
        connector.mapping(points -> {
            throw new IllegalStateException("configuration reloading");
        });
        pass.runPassNow();
        connector.mapping(points -> "mapping-v1");

        // when
        passAt(START.plus(Duration.ofMinutes(2)));

        // then
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.INSTALLED);
        assertThat(grantOf(booking).getLastFailure()).isNull();
        assertThat(grantOf(booking).getAttempts()).isZero();
    }
}
