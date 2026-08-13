package org.courtside.config.internal;

import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConfigServiceTest {

    @Test
    void givenGridAndTimeZoneChange_whenUpdating_thenGridConstraintReceivesBothNewValues() {
        // given
        ClubConfigurationRepository configurations = mock();
        ClubConfiguration configuration = mock();
        BookingGridConstraint constraint = mock();
        when(configurations.lockById(ClubConfiguration.SINGLETON_ID))
                .thenReturn(Optional.of(configuration));
        when(configurations.findById(ClubConfiguration.SINGLETON_ID))
                .thenReturn(Optional.of(configuration));
        when(configuration.getSlotMinutes()).thenReturn(30);
        when(configuration.getTimeZone()).thenReturn("Europe/Berlin");
        when(constraint.timeZoneConflictCode()).thenReturn(Optional.empty());
        when(constraint.conflictCode(any(), any())).thenReturn(Optional.empty());
        ConfigService service = new ConfigService(configurations, List.of(constraint));

        // when
        service.update("Example Tennis Club", "#004f2d", "#c8a415", null, null,
                "en", 45, "Pacific/Auckland");

        // then
        var slotDuration = org.mockito.ArgumentCaptor.forClass(BookingSlotDuration.class);
        var timeZone = org.mockito.ArgumentCaptor.forClass(ZoneId.class);
        verify(constraint).conflictCode(slotDuration.capture(), timeZone.capture());
        assertThat(slotDuration.getValue().minutes()).isEqualTo(45);
        assertThat(timeZone.getValue()).isEqualTo(ZoneId.of("Pacific/Auckland"));
    }
}
