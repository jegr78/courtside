package org.courtside.config;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.internal.ConfigService;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHoursGridMismatchException;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookingGridCoordinationTest extends AbstractIntegrationTest {

    @Autowired
    private BookingGridCoordination coordination;

    @Autowired
    private ConfigService config;

    @Autowired
    private FacilityService facility;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAnInvalidSlotDuration_whenUpdatingThroughTheService_thenTheInvariantIsRejected() {
        // when / then
        assertThatThrownBy(() -> config.update(
                "Example Tennis Club", "#b85c38", "#d7e24b", null, null, "de", 7))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("five-minute steps");
    }

    @Test
    void givenAnUncommittedGridChange_whenOpeningHoursAreChanged_thenTheWriterWaitsAndRejectsTheOldGrid()
            throws Exception {
        // given
        CountDownLatch gridChanged = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> gridChange = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        coordination.lock();
                        jdbc.sql("""
                                UPDATE club_config SET slot_minutes = 60
                                WHERE id = '00000000-0000-0000-0000-000000000001'
                                """).update();
                        gridChanged.countDown();
                        await(allowCommit);
                    }));
            assertThat(gridChanged.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> openingHoursChange = pool.submit(() -> facility.setOpeningHours(
                    DayOfWeek.MONDAY,
                    new OpeningWindow(LocalTime.of(8, 30), LocalTime.of(20, 30))));

            // then
            assertThatThrownBy(() -> openingHoursChange.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            gridChange.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> openingHoursChange.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(OpeningHoursGridMismatchException.class);
        } finally {
            allowCommit.countDown();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out while coordinating concurrent transactions");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while coordinating concurrent transactions", e);
        }
    }
}
