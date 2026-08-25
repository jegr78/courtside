package org.courtside.config;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({AuditTestFixture.class, RulesTestFixture.class})
class ConfigAuditTest extends AbstractIntegrationTest {

    @Autowired
    private ConfigService config;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private RulesTestFixture rules;

    @Test
    void givenTheConfiguration_whenOnlyTheClubNameChanges_thenOneEventNamesTheFieldAndNoValue() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withClubName(current, "Example Tennis Club"));

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
    void givenTheConfiguration_whenPeopleWithoutAMembershipTypeAreBound_thenTheEventNamesTheField() {
        // given
        UUID guests = rules.activeRuleSet("Guests");
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withNoMembershipTypeRuleSet(current, guests));

        // then
        Map<String, Object> payload = latestPayloadOf(ConfigEvent.ClubChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("noMembershipTypeRuleSetId"));
    }

    @Test
    void givenTheConfiguration_whenTheDefaultLocaleChanges_thenItsOwnEventCarriesTheNewLocale() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withLocale(current, "en"));

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
        config.update(withSlotMinutes(current, 60));

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
        config.update(withTimeZone(current, "UTC"));

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
        config.update(unchanged(current));

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
        config.update(withClubName(current, "Example Tennis Club"));

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

    private static ChangeClubConfigurationCommand unchanged(ClubConfigurationSnapshot current) {
        return change(current, current.clubName(), current.defaultLocale(),
                current.slotMinutes(), current.timeZone());
    }

    private static ChangeClubConfigurationCommand withClubName(ClubConfigurationSnapshot current, String clubName) {
        return change(current, clubName, current.defaultLocale(), current.slotMinutes(), current.timeZone());
    }

    private static ChangeClubConfigurationCommand withLocale(ClubConfigurationSnapshot current, String locale) {
        return change(current, current.clubName(), locale, current.slotMinutes(), current.timeZone());
    }

    private static ChangeClubConfigurationCommand withSlotMinutes(ClubConfigurationSnapshot current, int minutes) {
        return change(current, current.clubName(), current.defaultLocale(), minutes, current.timeZone());
    }

    private static ChangeClubConfigurationCommand withTimeZone(ClubConfigurationSnapshot current, String timeZone) {
        return change(current, current.clubName(), current.defaultLocale(), current.slotMinutes(), timeZone);
    }

    private static ChangeClubConfigurationCommand withNoMembershipTypeRuleSet(
            ClubConfigurationSnapshot current, UUID ruleSetId) {
        return change(current, current.clubName(), current.defaultLocale(), current.slotMinutes(),
                current.timeZone(), ruleSetId);
    }

    private static ChangeClubConfigurationCommand change(ClubConfigurationSnapshot current, String clubName,
                                                         String locale, int minutes, String timeZone) {
        return change(current, clubName, locale, minutes, timeZone,
                current.noMembershipTypeRuleSetId());
    }

    private static ChangeClubConfigurationCommand change(ClubConfigurationSnapshot current, String clubName,
                                                         String locale, int minutes, String timeZone,
                                                         UUID noMembershipTypeRuleSetId) {
        return new ChangeClubConfigurationCommand(clubName, current.primaryColor(), current.accentColor(),
                current.logoUrl(), current.imprintUrl(), locale,
                new BookingSlotDuration(minutes), timeZone,
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()), new ReminderLeadTime(24),
                noMembershipTypeRuleSetId);
    }
}
