package org.courtside.config.internal;

import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.shared.UnsupportedLanguageException;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.courtside.shared.testfixture.SupportedLanguagesFixture.shipping;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
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
        ConfigService service = new ConfigService(configurations, mock(),
                shipping("de", "en"), List.of(constraint), mock(ApplicationEventPublisher.class));

        // when
        service.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#004f2d", "#c8a415", null, null, "en",
                new BookingSlotDuration(45), "Pacific/Auckland",
                new CredentialLifetime(168), new CredentialLifetime(24), null));

        // then
        var slotDuration = org.mockito.ArgumentCaptor.forClass(BookingSlotDuration.class);
        var timeZone = org.mockito.ArgumentCaptor.forClass(ZoneId.class);
        verify(constraint).conflictCode(slotDuration.capture(), timeZone.capture());
        assertThat(slotDuration.getValue().minutes()).isEqualTo(45);
        assertThat(timeZone.getValue()).isEqualTo(ZoneId.of("Pacific/Auckland"));
    }

    @Test
    void givenALanguageTheImageShipsNoBundleFor_whenUpdating_thenNothingIsWritten() {
        // given
        ClubConfigurationRepository configurations = mock();
        ConfigService service = new ConfigService(configurations, mock(),
                shipping("de", "en"), List.of(), mock(ApplicationEventPublisher.class));

        // when / then — the guard sits before the row is locked, so no caller can leave it half done
        assertThatThrownBy(() -> service.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#004f2d", "#c8a415", null, null, "fr",
                new BookingSlotDuration(30), "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24), null)))
                .isInstanceOf(UnsupportedLanguageException.class)
                .extracting(failure -> ((UnsupportedLanguageException) failure).getParams())
                .isEqualTo(Map.of("locale", "fr", "supported", List.of("de", "en")));
        verifyNoInteractions(configurations);
    }
}
