package org.courtside;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SqlStatementCounterTest {

    @Test
    void givenAnActiveMeasurement_whenAnotherThreadRunsSql_thenOnlyTheOwnerThreadIsCounted()
            throws InterruptedException {
        // given
        SqlStatementCounter counter = new SqlStatementCounter();
        counter.reset();

        // when
        Thread background = Thread.ofPlatform().start(() -> counter.record("SELECT * FROM import_preview"));
        background.join();
        counter.record("SELECT * FROM booking");

        // then
        assertThat(counter.snapshot().total()).isEqualTo(1);
        assertThat(counter.snapshot().category("booking")).isEqualTo(1);
        assertThat(counter.snapshot().category("other")).isZero();
    }
}
