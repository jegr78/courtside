package org.courtside.config;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;

@Transactional
class ConfigServiceSnapshotTest extends AbstractIntegrationTest {

    @Autowired
    private ConfigService config;

    @Test
    void whenReadingConfigurationThroughTheService_thenAnImmutableSnapshotIsReturned() {
        // when
        ClubConfigurationSnapshot snapshot = config.current();

        // then
        assertThat(snapshot.getClass().isRecord()).isTrue();
        assertThat(snapshot.clubName()).isEqualTo("Courtside");
        assertThat(snapshot.defaultLocale()).isEqualTo("de");
        assertThat(snapshot.slotMinutes()).isEqualTo(30);
    }

    @Test
    void givenChangedConfiguration_whenUpdatingThroughTheService_thenAnImmutableSnapshotIsReturned() {
        // when
        ClubConfigurationSnapshot snapshot = config.update(
                "Example Tennis Club", "#34584A", "#D7E24B",
                "/logo.svg", "/imprint", "en", 15, "Pacific/Auckland", 72, 12);

        // then
        assertThat(snapshot.getClass().isRecord()).isTrue();
        assertThat(snapshot.clubName()).isEqualTo("Example Tennis Club");
        assertThat(snapshot.primaryColor()).isEqualTo("#34584A");
        assertThat(snapshot.accentColor()).isEqualTo("#D7E24B");
        assertThat(snapshot.logoUrl()).isEqualTo("/logo.svg");
        assertThat(snapshot.imprintUrl()).isEqualTo("/imprint");
        assertThat(snapshot.defaultLocale()).isEqualTo("en");
        assertThat(snapshot.slotMinutes()).isEqualTo(15);
        assertThat(snapshot.timeZone()).isEqualTo("Pacific/Auckland");
    }
}
