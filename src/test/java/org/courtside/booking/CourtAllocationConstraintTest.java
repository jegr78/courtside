package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CourtAllocationConstraintTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-12T17:00:00Z");
    private static final Instant EIGHT_PM = Instant.parse("2026-05-12T18:00:00Z");

    @Autowired
    private JdbcClient jdbc;

    private UUID courtA;
    private UUID courtB;

    @BeforeEach
    void setUp() {
        courtA = insertCourt(1);
        courtB = insertCourt(2);
    }

    @Test
    void givenAnOccupiedSlot_whenInsertingAnOverlappingAllocationOnTheSameCourt_thenItIsRejected() {
        // given
        insertAllocation(insertBooking(), courtA, SIX_PM, EIGHT_PM, "CONFIRMED");
        UUID second = insertBooking();

        // when / then
        assertThatThrownBy(() -> insertAllocation(second, courtA, SEVEN_PM, EIGHT_PM, "CONFIRMED"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("court_allocation_no_overlap");
    }

    @Test
    void givenAnAllocationEndingAtSeven_whenInsertingOneStartingAtSeven_thenItIsAccepted() {
        // given
        insertAllocation(insertBooking(), courtA, SIX_PM, SEVEN_PM, "CONFIRMED");
        UUID second = insertBooking();

        // when / then
        assertThatCode(() -> insertAllocation(second, courtA, SEVEN_PM, EIGHT_PM, "CONFIRMED"))
                .doesNotThrowAnyException();
    }

    @Test
    void givenAnOccupiedSlotOnOneCourt_whenInsertingTheSameRangeOnAnother_thenItIsAccepted() {
        // given
        insertAllocation(insertBooking(), courtA, SIX_PM, EIGHT_PM, "CONFIRMED");
        UUID second = insertBooking();

        // when / then
        assertThatCode(() -> insertAllocation(second, courtB, SIX_PM, EIGHT_PM, "CONFIRMED"))
                .doesNotThrowAnyException();
    }

    @Test
    void givenACancelledAllocation_whenInsertingTheSameRange_thenTheSlotIsFreeAgain() {
        // given
        insertAllocation(insertBooking(), courtA, SIX_PM, EIGHT_PM, "CANCELLED");
        UUID second = insertBooking();

        // when / then
        assertThatCode(() -> insertAllocation(second, courtA, SIX_PM, EIGHT_PM, "CONFIRMED"))
                .doesNotThrowAnyException();
    }

    @Test
    void whenInsertingAnAllocationThatEndsBeforeItStarts_thenItIsRejected() {
        // given
        UUID booking = insertBooking();

        // when / then
        assertThatThrownBy(() -> insertAllocation(booking, courtA, EIGHT_PM, SIX_PM, "CONFIRMED"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("court_allocation_valid_range");
    }

    @Test
    void givenABookingWithAnAllocation_whenTheBookingIsDeleted_thenTheAllocationIsDeletedToo() {
        // given
        UUID booking = insertBooking();
        insertAllocation(booking, courtA, SIX_PM, EIGHT_PM, "CONFIRMED");

        // when
        jdbc.sql("DELETE FROM booking WHERE id = ?").param(booking).update();

        // then
        Long remaining = jdbc.sql("SELECT count(*) FROM court_allocation")
                .query(Long.class)
                .single();
        assertThat(remaining).isZero();
    }

    private UUID insertCourt(int number) {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO court (id, number, active) VALUES (?, ?, true)")
                .params(id, number)
                .update();
        return id;
    }

    private UUID insertBooking() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status) VALUES (?, ?, 'CONFIRMED')")
                .params(id, MEMBER_BOOKING_CARD)
                .update();
        return id;
    }

    private void insertAllocation(UUID bookingId, UUID courtId,
                                  Instant startsAt, Instant endsAt, String status) {
        jdbc.sql("""
                        INSERT INTO court_allocation
                            (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), bookingId, courtId,
                        startsAt.atOffset(ZoneOffset.UTC), endsAt.atOffset(ZoneOffset.UTC), status)
                .update();
    }
}
