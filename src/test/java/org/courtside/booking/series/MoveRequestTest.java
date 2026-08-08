package org.courtside.booking.series;

import org.junit.jupiter.api.Test;

import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MoveRequestTest {

    private static final UUID SERIES = UUID.randomUUID();
    private static final UUID BOOKING = UUID.randomUUID();
    private static final UUID COURT = UUID.randomUUID();

    @Test
    void givenTheSameCourtTwice_whenBuildingAMoveRequest_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> moveTo(List.of(COURT, COURT)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("same court twice");
    }

    @Test
    void givenAnEmptyCourtList_whenBuildingAMoveRequest_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> moveTo(List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be empty");
    }

    @Test
    void givenTwoDistinctCourts_whenBuildingAMoveRequest_thenBothAreKept() {
        // when
        MoveRequest request = moveTo(List.of(COURT, UUID.randomUUID()));

        // then
        assertThat(request.newCourtIds()).hasSize(2);
    }

    @Test
    void givenNoCourtsAtAll_whenBuildingAMoveRequestThatChangesTheTime_thenItIsAccepted() {
        // when
        MoveRequest request = new MoveRequest(SERIES, BOOKING, CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null);

        // then
        assertThat(request.newCourtIds()).isNull();
    }

    private MoveRequest moveTo(List<UUID> newCourtIds) {
        return new MoveRequest(SERIES, BOOKING, CancelScope.WHOLE_SERIES, null, null, newCourtIds);
    }
}
