package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import javax.sql.DataSource;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class PassLockTest extends AbstractIntegrationTest {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenOneInstanceHoldsTheLock_whenAnotherTriesIt_thenOnlyAfterTheReleaseDoesItSucceed() {
        // given
        Optional<PassLock> first = PassLock.tryAcquire(dataSource);

        // when
        Optional<PassLock> whileHeld = PassLock.tryAcquire(dataSource);
        first.orElseThrow().close();
        Optional<PassLock> afterRelease = PassLock.tryAcquire(dataSource);

        // then
        assertThat(first).isPresent();
        assertThat(whileHeld).as("one pass at a time across instances").isEmpty();
        assertThat(afterRelease).isPresent();
        afterRelease.orElseThrow().close();
    }

    @Test
    void givenAHeldLock_whenItsSessionIsTerminated_thenTheHolderNoticesBeforeItsNextCall() {
        // given
        PassLock lock = PassLock.tryAcquire(dataSource).orElseThrow();
        boolean heldBefore = lock.stillHeld();

        // when
        jdbc.sql("""
                        SELECT pg_terminate_backend(pid) FROM pg_locks
                        WHERE locktype = 'advisory' AND classid = 0 AND objid = ? AND objsubid = 1
                        """).params(PassLock.KEY).query().listOfRows();

        // then
        assertThat(heldBefore).isTrue();
        assertThat(lock.stillHeld()).as("a lost session no longer excludes another instance").isFalse();
        lock.close();
        assertThat(PassLock.tryAcquire(dataSource)).hasValueSatisfying(PassLock::close);
    }
}
