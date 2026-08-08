package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookingSeriesTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant CREATED_AT = Instant.parse("2026-04-01T08:00:00Z");

    @Autowired
    private BookingSeriesRepository series;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenASeriesEndingOnADate_whenStored_thenTheRuleSurvivesTheRoundTrip() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(UUID.randomUUID(), UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY),
                LocalDate.of(2026, 9, 29), null);

        // when
        UUID id = series.saveAndFlush(
                new BookingSeries(rule, UUID.randomUUID(), "Training", CREATED_AT)).getId();

        // then
        SeriesRule stored = series.findById(id).orElseThrow().getRule();
        assertThat(stored.weekdays()).containsExactlyInAnyOrder(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY);
        assertThat(stored.endsOn()).isEqualTo(LocalDate.of(2026, 9, 29));
        assertThat(stored.occurrenceCount()).isNull();
        assertThat(stored.durationMinutes()).isEqualTo(120);
    }

    @Test
    void whenBuildingARuleWithBothAnEndDateAndACount_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), LocalDate.of(2026, 9, 29), 10))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithNeitherAnEndDateNorACount_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithNoWeekday_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(), LocalDate.of(2026, 9, 29), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithAZeroOccurrenceCount_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithANegativeOccurrenceCount_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, -1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleLongerThanADay_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 1441,
                1, Set.of(DayOfWeek.TUESDAY), null, 2))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithAnIntervalBeyondAYear_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                53, Set.of(DayOfWeek.TUESDAY), null, 2))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleWithMoreOccurrencesThanAllowed_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, SeriesRule.MAX_OCCURRENCES + 1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenBuildingARuleThatEndsBeforeItStarts_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new SeriesRule(
                List.of(UUID.randomUUID()), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), LocalDate.of(2026, 4, 6), null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenARowWithAZeroOccurrenceCount_whenInsertedDirectly_thenTheDatabaseRefusesIt() {
        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                        INSERT INTO booking_series (id, card_id, court_ids, starts_on, start_time,
                                                    duration_minutes, interval_weeks, weekdays,
                                                    occurrence_count)
                        VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
                                ARRAY['11111111-1111-1111-1111-111111111111']::uuid[],
                                DATE '2026-04-07', TIME '18:00', 120, 1, ARRAY[2]::smallint[], 0)
                        """).update())
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
