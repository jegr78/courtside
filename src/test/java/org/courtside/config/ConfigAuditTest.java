package org.courtside.config;

import org.courtside.config.ResetTokenLifetime;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

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
    void givenTheConfiguration_whenTheAccessSettingsChange_thenTheEventNamesEachChangedField() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withAccess(current, new AccessLeadTime(30), new AccessLagTime(current.accessLagMinutes()),
                new AccessCodeLength(4)));

        // then
        assertThat(latestPayloadOf(ConfigEvent.ClubChanged.TYPE))
                .containsEntry("changedFields", List.of("accessLeadMinutes", "accessCodeLength"));
        assertThat(config.accessLead()).isEqualTo(new AccessLeadTime(30));
        assertThat(config.accessCodeLength()).isEqualTo(new AccessCodeLength(4));
    }

    @Test
    void givenTheConfiguration_whenExternalBookingsAreAdmitted_thenTheEventNamesTheField() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withExternalBookings(current, true));

        // then
        assertThat(latestPayloadOf(ConfigEvent.ClubChanged.TYPE))
                .containsEntry("changedFields", List.of("externalBookings"));
        assertThat(config.current().externalBookings()).isTrue();
    }

    @Test
    void givenExternalBookingsAdmitted_whenAChangeOmitsTheSwitch_thenItStaysOnAndIsNotNamed() {
        // given
        config.update(withExternalBookings(config.current(), true));
        ClubConfigurationSnapshot current = config.current();
        long switchChanges = changesNaming(List.of("externalBookings"));
        long nameChanges = changesNaming(List.of("clubName"));

        // when
        config.update(withExternalBookings(withClubName(current, current.clubName() + " Annex"), null));

        // then
        assertThat(changesNaming(List.of("clubName"))).isEqualTo(nameChanges + 1);
        assertThat(changesNaming(List.of("externalBookings"))).as("an omitted switch is not a change")
                .isEqualTo(switchChanges);
        assertThat(config.current().externalBookings()).isTrue();
    }

    @Test
    void givenTheConfiguration_whenOnlyTheEnglishRegistrationTextChanges_thenTheEventNamesThatFieldAlone() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withRegistrationTexts(current, new ChangeClubConfigurationCommand.RegistrationTexts(
                current.registrationTextDe(), "Guests pay at the court.")));

        // then
        assertThat(latestPayloadOf(ConfigEvent.ClubChanged.TYPE))
                .containsEntry("changedFields", List.of("registrationTextEn"));
        assertThat(config.current().registrationTextEn()).isEqualTo("Guests pay at the court.");
    }

    @Test
    void givenTheConfiguration_whenOnlyThePrivacyLinkChanges_thenTheEventNamesTheFieldAndNoValue() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withPrivacyUrl(current, "https://example-tennis-club.example/privacy"));

        // then
        Map<String, Object> payload = latestPayloadOf(ConfigEvent.ClubChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("privacyUrl"));
        assertThat(payload.toString()).doesNotContain("example-tennis-club.example");
    }

    @Test
    void givenTheConfiguration_whenOnlyTheDocumentationLinkChanges_thenTheEventNamesTheFieldAndNoValue() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withDocumentationUrl(current, "https://docs.example.org/courtside"));

        // then
        Map<String, Object> payload = latestPayloadOf(ConfigEvent.ClubChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("documentationUrl"));
        assertThat(payload.toString()).doesNotContain("docs.example.org");
    }

    @Test
    void givenTheConfiguration_whenOnlyTheShortNameChanges_thenTheEventNamesTheFieldAndNoValue() {
        // given
        ClubConfigurationSnapshot current = config.current();

        // when
        config.update(withShortName(current, "ETC Example"));

        // then
        Map<String, Object> payload = latestPayloadOf(ConfigEvent.ClubChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("shortName"));
        assertThat(payload.toString()).doesNotContain("ETC Example");
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

    private long changesNaming(List<String> fields) {
        return audit.eventsOfType(ConfigEvent.ClubChanged.TYPE).stream()
                .filter(event -> fields.equals(event.payload().get("changedFields")))
                .count();
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

    private static ChangeClubConfigurationCommand withExternalBookings(
            ClubConfigurationSnapshot current, Boolean externalBookings) {
        return withExternalBookings(withClubName(current, current.clubName()), externalBookings);
    }

    private static ChangeClubConfigurationCommand withExternalBookings(
            ChangeClubConfigurationCommand base, Boolean externalBookings) {
        return new ChangeClubConfigurationCommand(base.clubName(), base.primaryColor(), base.accentColor(),
                base.logoUrl(), base.imprintUrl(), base.privacyUrl(), base.documentationUrl(), base.shortName(),
                base.defaultLocale(), base.slotDuration(), base.timeZone(), base.newAccountCredential(),
                base.passwordResetCredential(), base.passwordResetToken(), base.bookingReminder(),
                base.noMembershipTypeRuleSetId(), base.waitlistOffer(), base.accessLead(), base.accessLag(),
                base.accessCodeLength(), base.currency(), externalBookings);
    }

    private static ChangeClubConfigurationCommand withRegistrationTexts(
            ClubConfigurationSnapshot current, ChangeClubConfigurationCommand.RegistrationTexts texts) {
        ChangeClubConfigurationCommand base = withClubName(current, current.clubName());
        return new ChangeClubConfigurationCommand(base.clubName(), base.primaryColor(), base.accentColor(),
                base.logoUrl(), base.imprintUrl(), base.privacyUrl(), base.documentationUrl(), base.shortName(),
                base.defaultLocale(), base.slotDuration(), base.timeZone(), base.newAccountCredential(),
                base.passwordResetCredential(), base.passwordResetToken(), base.bookingReminder(),
                base.noMembershipTypeRuleSetId(), base.waitlistOffer(), base.accessLead(), base.accessLag(),
                base.accessCodeLength(), base.currency(), null, texts);
    }

    private static ChangeClubConfigurationCommand withPrivacyUrl(
            ClubConfigurationSnapshot current, String privacyUrl) {
        return new ChangeClubConfigurationCommand(current.clubName(), current.primaryColor(),
                current.accentColor(), current.logoFallbackUrl(), current.imprintUrl(), privacyUrl,
                current.documentationUrl(), current.shortName(),
                current.defaultLocale(), new BookingSlotDuration(current.slotMinutes()),
                current.timeZone(), new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                new ResetTokenLifetime(60), new ReminderLeadTime(current.bookingReminderHours()),
                current.noMembershipTypeRuleSetId(), null, null, null, null);
    }

    private static ChangeClubConfigurationCommand withDocumentationUrl(
            ClubConfigurationSnapshot current, String documentationUrl) {
        return new ChangeClubConfigurationCommand(current.clubName(), current.primaryColor(),
                current.accentColor(), current.logoFallbackUrl(), current.imprintUrl(),
                current.privacyUrl(), documentationUrl, current.shortName(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                new ResetTokenLifetime(60), new ReminderLeadTime(current.bookingReminderHours()),
                current.noMembershipTypeRuleSetId(), null, null, null, null);
    }

    private static ChangeClubConfigurationCommand withAccess(ClubConfigurationSnapshot current,
                                                             AccessLeadTime lead, AccessLagTime lag,
                                                             AccessCodeLength length) {
        return new ChangeClubConfigurationCommand(current.clubName(), current.primaryColor(),
                current.accentColor(), current.logoFallbackUrl(), current.imprintUrl(),
                current.privacyUrl(), current.documentationUrl(), current.shortName(), current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                new ResetTokenLifetime(60), new ReminderLeadTime(current.bookingReminderHours()),
                current.noMembershipTypeRuleSetId(), null, lead, lag, length);
    }

    private static ChangeClubConfigurationCommand withShortName(
            ClubConfigurationSnapshot current, String shortName) {
        return new ChangeClubConfigurationCommand(current.clubName(), current.primaryColor(),
                current.accentColor(), current.logoFallbackUrl(), current.imprintUrl(),
                current.privacyUrl(), current.documentationUrl(), shortName, current.defaultLocale(),
                new BookingSlotDuration(current.slotMinutes()), current.timeZone(),
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()),
                new ResetTokenLifetime(60), new ReminderLeadTime(current.bookingReminderHours()),
                current.noMembershipTypeRuleSetId(), null, null, null, null);
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
                current.logoFallbackUrl(), current.imprintUrl(), current.privacyUrl(),
                current.documentationUrl(), current.shortName(), locale,
                new BookingSlotDuration(minutes), timeZone,
                new CredentialLifetime(current.newAccountCredentialHours()),
                new CredentialLifetime(current.passwordResetCredentialHours()), new ResetTokenLifetime(60), new ReminderLeadTime(24),
                noMembershipTypeRuleSetId, null, null, null, null);
    }
}
