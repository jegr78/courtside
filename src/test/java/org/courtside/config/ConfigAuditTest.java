package org.courtside.config;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(AuditTestFixture.class)
class ConfigAuditTest extends AbstractIntegrationTest {

    @Autowired
    private ConfigService config;

    @Autowired
    private AuditTestFixture audit;

    @Test
    void givenTheConfiguration_whenOnlyTheClubNameChanges_thenOneEventNamesTheFieldAndNoValue() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update("Example Tennis Club", current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                current.slotMinutes(), current.timeZone());

        // then
        Map<String, Object> payload = latestPayloadOf(ConfigEvent.ClubChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("clubName"));
        assertThat(payload).doesNotContainKey("clubName");
        assertThat(payload.toString()).doesNotContain("Example Tennis Club");
        assertThat(countOf(ConfigEvent.SlotDurationChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.LocaleChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.TimeZoneChanged.TYPE)).isZero();
    }

    @Test
    void givenTheConfiguration_whenTheDefaultLocaleChanges_thenItsOwnEventCarriesTheNewLocale() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), "en",
                current.slotMinutes(), current.timeZone());

        // then
        assertThat(latestPayloadOf(ConfigEvent.LocaleChanged.TYPE)).containsEntry("defaultLocale", "en");
        assertThat(countOf(ConfigEvent.ClubChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.SlotDurationChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.TimeZoneChanged.TYPE)).isZero();
    }

    @Test
    void givenTheConfiguration_whenTheSlotDurationChanges_thenItsOwnEventCarriesTheMinutes() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                60, current.timeZone());

        // then
        assertThat(latestPayloadOf(ConfigEvent.SlotDurationChanged.TYPE)).containsEntry("slotMinutes", 60);
        assertThat(countOf(ConfigEvent.ClubChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.LocaleChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.TimeZoneChanged.TYPE)).isZero();
    }

    @Test
    void givenTheConfiguration_whenTheTimeZoneChanges_thenItsOwnEventCarriesTheZone() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                current.slotMinutes(), "UTC");

        // then
        assertThat(latestPayloadOf(ConfigEvent.TimeZoneChanged.TYPE)).containsEntry("timeZone", "UTC");
        assertThat(countOf(ConfigEvent.ClubChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.LocaleChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.SlotDurationChanged.TYPE)).isZero();
    }

    @Test
    void givenTheConfiguration_whenNothingChanges_thenNothingIsRecorded() {
        // given
        ClubConfigurationSnapshot current = config.current();
        int before = countOf(ConfigEvent.ClubChanged.TYPE);

        // when
        config.update(current.clubName(), current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                current.slotMinutes(), current.timeZone());

        // then
        assertThat(countOf(ConfigEvent.ClubChanged.TYPE)).isEqualTo(before);
        assertThat(countOf(ConfigEvent.LocaleChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.SlotDurationChanged.TYPE)).isZero();
        assertThat(countOf(ConfigEvent.TimeZoneChanged.TYPE)).isZero();
    }

    @Test
    void givenTheConfiguration_whenItIsChanged_thenTheAuditLogCanNameIt() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update("Example Tennis Club", current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), current.defaultLocale(),
                current.slotMinutes(), current.timeZone());

        // then
        UUID configId = UUID.fromString((String) latestPayloadOf(ConfigEvent.ClubChanged.TYPE).get("configId"));
        assertThat(audit.nameOf(configId)).isEqualTo("Example Tennis Club");
    }

    private Map<String, Object> latestPayloadOf(String eventType) {
        return audit.eventsOfType(eventType).stream()
                .reduce((first, second) -> second)
                .map(RecordedEvent::payload)
                .orElseThrow();
    }

    private int countOf(String eventType) {
        return audit.eventsOfType(eventType).size();
    }
}
