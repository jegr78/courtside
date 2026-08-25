package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.internal.SessionCleanupCadence;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.session.jdbc.autoconfigure.JdbcSessionProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Timeout(value = 60, unit = TimeUnit.SECONDS)
// Named as the deployment names it, so this also holds that the documented variable reaches
// the cleanup rather than being a row in a table nothing reads.
@TestPropertySource(properties = "COURTSIDE_SESSION_CLEANUP_CRON=* * * * * *")
class SessionCleanupTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private JdbcSessionProperties properties;

    @Autowired
    private ApplicationContext context;

    @Autowired
    private JdbcIndexedSessionRepository sessions;

    @Test
    void whenTheDeploymentNamesACadence_thenTheCleanupIsTheThingItConfigures() {
        // when / then
        assertThat(properties.getCleanupCron())
                .as("COURTSIDE_SESSION_CLEANUP_CRON is documented in deploy/README.md; a value that"
                        + " does not reach the cleanup makes that row describe nothing")
                .isEqualTo("* * * * * *");
    }

    @Test
    void whenTheApplicationStarts_thenTheCadenceIsHeldToOneThatDeletes() {
        // when / then
        assertThat(context.getBeanNamesForType(SessionCleanupCadence.class))
                .as("without the guard a deployment can switch the cleanup off, and section 11 of"
                        + " the design specification says it cannot")
                .isNotEmpty();
    }

    @Test
    void givenASessionPastItsExpiry_whenTheCleanupRuns_thenItGoesWhileALiveOneStays() {
        // given
        String expired = storedSession(Duration.ofDays(-1));
        String live = storedSession(Duration.ofDays(1));

        // when — what the cadence above reaches, called rather than waited for: a sweep firing on
        // its own would race the truncate every other test does between cases
        sessions.cleanUpExpiredSessions();

        // then
        assertThat(rowsFor(expired)).isZero();
        assertThat(rowsFor(live))
                .as("a session that has not expired is not swept along with one that has")
                .isEqualTo(1);
    }

    private String storedSession(Duration untilExpiry) {
        String id = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        jdbc.sql("""
                        INSERT INTO spring_session
                            (primary_id, session_id, creation_time, last_access_time,
                             max_inactive_interval, expiry_time, principal_name)
                        VALUES (:id, :id, :now, :now, 1800, :expiry, 'jane.doe')
                        """)
                .param("id", id)
                .param("now", now)
                .param("expiry", now + untilExpiry.toMillis())
                .update();
        return id;
    }

    private long rowsFor(String sessionId) {
        return jdbc.sql("SELECT count(*) FROM spring_session WHERE session_id = :id")
                .param("id", sessionId).query(Long.class).single();
    }
}
