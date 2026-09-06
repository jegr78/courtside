package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.session.autoconfigure.SessionProperties;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.session.Session;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

// Named as the deployment names them, so this holds that the documented variables reach the
// behaviour rather than describing rows nothing reads.
class SessionLifetimeTest extends AbstractIntegrationTest {

    @Autowired
    private SessionProperties inactivity;

    @Autowired
    private JdbcIndexedSessionRepository sessions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void whenTheApplicationStarts_thenTheInactivityWindowIsTheOneItStatesAndNotSpringsDefault() {
        // when / then
        assertThat(inactivity.getTimeout())
                .as("COURTSIDE_SESSION_INACTIVITY_TIMEOUT is what a deployment sets; unset, the"
                        + " window would be whatever Spring defaults to and could change under it")
                .isEqualTo(Duration.ofMinutes(30));
    }

    @Test
    void whenASessionIsCreated_thenItCarriesTheStatedInactivityWindow() {
        // given
        Session session = sessions.createSession();

        // when / then
        assertThat(session.getMaxInactiveInterval()).isEqualTo(Duration.ofMinutes(30));
    }

    @Test
    void givenASessionStoredBeforeThisProcessStarted_whenItIsRead_thenItsAgeComesFromTheRow() {
        // given — active, but alive for a day and a half. Spring Session decides expiry against the
        // system clock, so the row is written against that one; the age under test is the offset.
        Instant reference = Instant.ofEpochMilli(System.currentTimeMillis());
        Instant created = reference.minus(Duration.ofHours(36));
        String id = storedSession(reference, created);

        // when — read the way a restarted application reads it, from the row and not from memory
        Session restored = sessions.findById(id);

        // then
        assertThat(restored).isNotNull();
        assertThat(restored.getCreationTime())
                .as("a restart that reset this would hand every live session a fresh lifetime")
                .isEqualTo(created.truncatedTo(ChronoUnit.MILLIS));
        assertThat(Duration.between(restored.getCreationTime(), reference))
                .as("the age the filter reads is the one the row carries, past the absolute lifetime")
                .isGreaterThan(Duration.ofHours(24));
    }

    private String storedSession(Instant reference, Instant created) {
        String id = UUID.randomUUID().toString();
        jdbc.sql("""
                        INSERT INTO spring_session
                            (primary_id, session_id, creation_time, last_access_time,
                             max_inactive_interval, expiry_time, principal_name)
                        VALUES (:id, :id, :creation, :accessed, 1800, :expiry, 'jane.doe')
                        """)
                .param("id", id)
                .param("creation", created.toEpochMilli())
                .param("accessed", reference.toEpochMilli())
                .param("expiry", reference.plus(Duration.ofMinutes(30)).toEpochMilli())
                .update();
        return id;
    }
}
