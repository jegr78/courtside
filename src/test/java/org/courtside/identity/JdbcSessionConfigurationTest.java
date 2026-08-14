package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.session.SessionRepository;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;

import static org.assertj.core.api.Assertions.assertThat;

class JdbcSessionConfigurationTest extends AbstractIntegrationTest {

    @Autowired
    private SessionRepository<?> sessions;

    @Test
    void whenApplicationStarts_thenHttpSessionsUsePostgreSql() {
        // when / then
        assertThat(sessions).isInstanceOf(JdbcIndexedSessionRepository.class);
    }
}
