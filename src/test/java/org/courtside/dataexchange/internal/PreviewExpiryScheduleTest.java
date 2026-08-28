package org.courtside.dataexchange.internal;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class PreviewExpiryScheduleTest {

    @Test
    void whenTheScheduleRuns_thenExpiredPreviewsAreSwept() {
        // given
        PreviewExpiry expiry = mock(PreviewExpiry.class);
        PreviewExpirySchedule schedule = new PreviewExpirySchedule(expiry);

        // when
        schedule.sweepNow();

        // then
        verify(expiry).sweepNow();
    }
}
