package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.postgresql.util.PSQLException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import(FacilityTestFixture.class)
class BookingSeriesCourtConcurrencyTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private BookingSeriesRepository series;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private DataSource dataSource;

    @Test
    void givenTwoCourts_whenConcurrentTransactionsRemoveOneEach_thenOneRemovalIsRejected()
            throws Exception {
        // given
        UUID firstCourt = facilityFixture.createCourt(1, "Court 1");
        UUID secondCourt = facilityFixture.createCourt(2, "Court 2");
        SeriesRule rule = new SeriesRule(
                List.of(firstCourt, secondCourt), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        UUID seriesId = series.saveAndFlush(new BookingSeries(
                rule, UUID.randomUUID(), "Training", Instant.parse("2026-04-01T08:00:00Z"))).getId();
        CyclicBarrier deletionsReady = new CyclicBarrier(2);

        // when
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(removeCourt(seriesId, firstCourt, deletionsReady));
            var second = pool.submit(removeCourt(seriesId, secondCourt, deletionsReady));

            // then
            assertThat(Arrays.asList(
                    first.get(20, TimeUnit.SECONDS),
                    second.get(20, TimeUnit.SECONDS))).satisfiesExactlyInAnyOrder(
                    result -> assertThat(result).isNull(),
                    result -> {
                        assertThat(result).isNotNull();
                        assertThat(rootCause(result)).isInstanceOfSatisfying(
                                PSQLException.class, sqlFailure ->
                                        assertThat(sqlFailure.getServerErrorMessage().getConstraint())
                                                .isEqualTo("booking_series_has_a_court"));
                    });
        }
        assertThat(jdbc.sql("""
                        SELECT count(*) FROM booking_series_court WHERE booking_series_id = ?
                        """)
                .param(seriesId)
                .query(Long.class)
                .single()).isEqualTo(1);
    }

    private Callable<Throwable> removeCourt(UUID seriesId, UUID courtId, CyclicBarrier deletionsReady) {
        return () -> {
            try {
                new TransactionTemplate(new DataSourceTransactionManager(dataSource))
                        .executeWithoutResult(status -> {
                            jdbc.sql("""
                                            DELETE FROM booking_series_court
                                            WHERE booking_series_id = ? AND court_id = ?
                                            """)
                                    .params(seriesId, courtId)
                                    .update();
                            await(deletionsReady);
                        });
                return null;
            } catch (RuntimeException failure) {
                return failure;
            }
        };
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(10, TimeUnit.SECONDS);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private Throwable rootCause(Throwable failure) {
        Throwable cause = failure;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause;
    }
}
