package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Duration;
import java.util.concurrent.FutureTask;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PostgresDiagnosticsTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAStuckOperation_whenAwaitingIt_thenTheFailureContainsDatabaseAndThreadDiagnostics() {
        // given
        FutureTask<Void> operation = new FutureTask<>(() -> null);

        // when / then
        assertThatThrownBy(() -> PostgresDiagnostics.await(
                operation, Duration.ofMillis(1), jdbc, "Forced operation"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("Forced operation timed out")
                .hasMessageContaining("PostgreSQL:")
                .hasMessageContaining("Threads:");
    }
}
