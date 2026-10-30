package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
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
        int heldAfterClose = jdbc.sql("""
                        SELECT count(*) FROM pg_locks
                        WHERE locktype = 'advisory' AND classid = 0 AND objid = ? AND objsubid = 1
                        """).params(PassLock.KEY).query(Integer.class).single();
        Optional<PassLock> afterRelease = PassLock.tryAcquire(dataSource);

        // then
        assertThat(first).isPresent();
        assertThat(whileHeld).as("one pass at a time across instances").isEmpty();
        assertThat(heldAfterClose).as("a pooled session must not keep the lock").isZero();
        assertThat(afterRelease).isPresent();
        afterRelease.orElseThrow().close();
    }

    @Test
    void givenAnUnlockThatFailsOnALiveSession_whenTheLockIsClosed_thenTheSessionEndsAndAnotherCanTakeTheLock() {
        // given
        PassLock lock = PassLock.tryAcquire(failingUnlock(dataSource)).orElseThrow();

        // when
        lock.close();

        // then
        assertThat(heldWithin(Duration.ofSeconds(5)))
                .as("a connection that kept the lock must not return to the pool").isFalse();
        assertThat(PassLock.tryAcquire(dataSource)).hasValueSatisfying(PassLock::close);
    }

    private boolean heldWithin(Duration patience) {
        long deadline = System.nanoTime() + patience.toNanos();
        while (System.nanoTime() < deadline) {
            if (jdbc.sql("""
                            SELECT count(*) FROM pg_locks
                            WHERE locktype = 'advisory' AND classid = 0 AND objid = ? AND objsubid = 1
                            """).params(PassLock.KEY).query(Integer.class).single() == 0) {
                return false;
            }
            Thread.onSpinWait();
        }
        return true;
    }

    private static DataSource failingUnlock(DataSource real) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, arguments) -> {
                    Object result = invoke(method, real, arguments);
                    return result instanceof Connection connection ? failingUnlock(connection) : result;
                });
    }

    private static Connection failingUnlock(Connection real) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, arguments) -> {
                    Object result = invoke(method, real, arguments);
                    return result instanceof Statement statement ? failingUnlock(statement) : result;
                });
    }

    private static Statement failingUnlock(Statement real) {
        return (Statement) Proxy.newProxyInstance(Statement.class.getClassLoader(), new Class<?>[] {Statement.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals("executeQuery") && String.valueOf(arguments[0]).contains("unlock")) {
                        throw new SQLException("network timeout");
                    }
                    return invoke(method, real, arguments);
                });
    }

    private static Object invoke(Method method, Object target, Object[] arguments) throws Throwable {
        try {
            return method.invoke(target, arguments);
        } catch (InvocationTargetException failed) {
            throw failed.getCause();
        }
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
