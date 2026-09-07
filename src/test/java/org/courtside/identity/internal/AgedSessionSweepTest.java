package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AgedSessionSweepTest extends AbstractIntegrationTest {

    @Autowired
    private AgedSessionSweep sweep;

    @Autowired
    private JdbcClient jdbc;

    // Spring Session's own cleanup deletes by expiry_time, which is built from the inactivity window
    // alone, so both rows here would survive it: neither has been idle.
    @Test
    void givenASessionPastItsLifetimeButNotIdle_whenTheSweepRuns_thenItsRowGoesAndAYoungOneStays() {
        // given
        String aged = storedSession(Duration.ofHours(25));
        String young = storedSession(Duration.ofHours(1));

        // when — called rather than waited for. Spring Session runs its own cleanup on a scheduler
        // of its own, which no profile disables; both rows outlive it because neither is idle.
        sweep.deleteSessionsPastTheirLifetime();

        // then
        assertThat(rowsFor(aged))
                .as("the attributes cascading from the row carry the username, the account id, the"
                        + " roles and the security epoch, and the session they belonged to is over")
                .isZero();
        assertThat(rowsFor(young)).isEqualTo(1);
    }

    private String storedSession(Duration age) {
        String id = UUID.randomUUID().toString();
        long created = System.currentTimeMillis() - age.toMillis();
        jdbc.sql("""
                        INSERT INTO spring_session
                            (primary_id, session_id, creation_time, last_access_time,
                             max_inactive_interval, expiry_time, principal_name)
                        VALUES (:id, :id, :created, :accessed, 1800, :expiry, 'jane.doe')
                        """)
                .param("id", id)
                .param("created", created)
                .param("accessed", System.currentTimeMillis())
                .param("expiry", System.currentTimeMillis() + Duration.ofMinutes(30).toMillis())
                .update();
        return id;
    }

    private long rowsFor(String sessionId) {
        return jdbc.sql("SELECT count(*) FROM spring_session WHERE session_id = :id")
                .param("id", sessionId).query(Long.class).single();
    }
}
