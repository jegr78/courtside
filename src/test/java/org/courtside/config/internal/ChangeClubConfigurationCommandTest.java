package org.courtside.config.internal;

import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChangeClubConfigurationCommandTest {

    @Test
    void givenEveryFieldTheInstanceNeeds_whenBuildingTheChange_thenItCarriesThem() {
        // when
        ChangeClubConfigurationCommand command = complete();

        // then
        assertThat(command.slotDuration().minutes()).isEqualTo(30);
        assertThat(command.newAccountCredential().hours()).isEqualTo(168);
        assertThat(command.passwordResetCredential().hours()).isEqualTo(24);
    }

    @Test
    void givenNoLogoAndNoImprint_whenBuildingTheChange_thenTheyMayStayUnset() {
        // when / then
        assertThatCode(() -> new ChangeClubConfigurationCommand("Example Tennis Club", "#004f2d",
                "#c8a415", null, null, "de", new BookingSlotDuration(30), "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24)))
                .doesNotThrowAnyException();
    }

    @Test
    void whenTheGridIsMissing_thenTheChangeIsRefusedNamingIt() {
        // when / then
        assertThatThrownBy(() -> new ChangeClubConfigurationCommand("Example Tennis Club", "#004f2d",
                "#c8a415", null, null, "de", null, "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("slotDuration");
    }

    @Test
    void whenACredentialLifetimeIsMissing_thenTheChangeIsRefusedNamingIt() {
        // when / then
        assertThatThrownBy(() -> new ChangeClubConfigurationCommand("Example Tennis Club", "#004f2d",
                "#c8a415", null, null, "de", new BookingSlotDuration(30), "Europe/Berlin",
                null, new CredentialLifetime(24)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("newAccountCredential");
    }

    @Test
    void whenTheClubHasNoName_thenTheChangeIsRefusedNamingIt() {
        // when / then
        assertThatThrownBy(() -> new ChangeClubConfigurationCommand(null, "#004f2d",
                "#c8a415", null, null, "de", new BookingSlotDuration(30), "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("clubName");
    }

    private static ChangeClubConfigurationCommand complete() {
        return new ChangeClubConfigurationCommand("Example Tennis Club", "#004f2d", "#c8a415",
                "/branding/logo.svg", "https://example-tennis-club.example/imprint", "de",
                new BookingSlotDuration(30), "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24));
    }
}
