package org.courtside.config;

import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.AbstractIntegrationTest;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;

import static org.assertj.core.api.Assertions.assertThat;

@Transactional
class ConfigServiceSnapshotTest extends AbstractIntegrationTest {

    private static final UUID YOUTH_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");

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
        ClubConfigurationSnapshot snapshot = config.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#34584A", "#D7E24B",
                "/logo.svg", "/imprint", "/privacy", "en",
                new BookingSlotDuration(15), "Pacific/Auckland",
                new CredentialLifetime(72), new CredentialLifetime(12), new ReminderLeadTime(24), null));

        // then
        assertThat(snapshot.getClass().isRecord()).isTrue();
        assertThat(snapshot.clubName()).isEqualTo("Example Tennis Club");
        assertThat(snapshot.primaryColor()).isEqualTo("#34584A");
        assertThat(snapshot.accentColor()).isEqualTo("#D7E24B");
        assertThat(snapshot.logoUrl()).isEqualTo("/logo.svg");
        assertThat(snapshot.logoFallbackUrl()).isEqualTo("/logo.svg");
        assertThat(snapshot.logoUploaded()).isFalse();
        assertThat(snapshot.imprintUrl()).isEqualTo("/imprint");
        assertThat(snapshot.privacyUrl()).isEqualTo("/privacy");
        assertThat(snapshot.defaultLocale()).isEqualTo("en");
        assertThat(snapshot.slotMinutes()).isEqualTo(15);
        assertThat(snapshot.timeZone()).isEqualTo("Pacific/Auckland");
    }

    @Test
    void givenNoRuleSetForPeopleWithoutAMembershipType_whenReadingTheConfiguration_thenNoneIsNamed() {
        // when
        ClubConfigurationSnapshot snapshot = config.current();

        // then
        assertThat(snapshot.noMembershipTypeRuleSetId()).isNull();
    }

    @Test
    void givenARuleSetForPeopleWithoutAMembershipType_whenUpdating_thenTheSnapshotCarriesIt() {
        // when
        ClubConfigurationSnapshot snapshot = config.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#34584A", "#D7E24B",
                "/logo.svg", "/imprint", "/privacy", "en",
                new BookingSlotDuration(15), "Pacific/Auckland",
                new CredentialLifetime(72), new CredentialLifetime(12), new ReminderLeadTime(24), YOUTH_RULE_SET));

        // then
        assertThat(snapshot.noMembershipTypeRuleSetId()).isEqualTo(YOUTH_RULE_SET);
    }

    @Test
    void givenAnAssignedRuleSet_whenClearingIt_thenTheConfigurationNamesNoneAgain() {
        // given
        config.update(commandWith(YOUTH_RULE_SET));

        // when
        ClubConfigurationSnapshot snapshot = config.update(commandWith(null));

        // then
        assertThat(snapshot.noMembershipTypeRuleSetId()).isNull();
    }

    @Test
    void givenAnUploadedLogo_whenChangingItsFallback_thenTheUploadRemainsEffectiveUntilDeleted() {
        // given
        config.uploadLogo(image());

        // when
        ClubConfigurationSnapshot changed = config.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#34584A", "#D7E24B",
                "/new-logo.svg", "/imprint", "/privacy", "en",
                new BookingSlotDuration(15), "Pacific/Auckland",
                new CredentialLifetime(72), new CredentialLifetime(12), new ReminderLeadTime(24), null));
        ClubConfigurationSnapshot deleted = config.deleteLogo();

        // then
        assertThat(changed.logoUploaded()).isTrue();
        assertThat(changed.logoUrl()).startsWith("/api/public/config/logo?v=");
        assertThat(changed.logoFallbackUrl()).isEqualTo("/new-logo.svg");
        assertThat(deleted.logoUploaded()).isFalse();
        assertThat(deleted.logoUrl()).isEqualTo("/new-logo.svg");
    }

    private static ChangeClubConfigurationCommand commandWith(UUID noMembershipTypeRuleSetId) {
        return new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#34584A", "#D7E24B",
                "/logo.svg", "/imprint", "/privacy", "en",
                new BookingSlotDuration(15), "Pacific/Auckland",
                new CredentialLifetime(72), new CredentialLifetime(12), new ReminderLeadTime(24), noMembershipTypeRuleSetId);
    }

    private static byte[] image() {
        try {
            BufferedImage image = new BufferedImage(12, 12, BufferedImage.TYPE_INT_RGB);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            ImageIO.write(image, "png", output);
            return output.toByteArray();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
