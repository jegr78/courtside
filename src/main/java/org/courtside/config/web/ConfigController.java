package org.courtside.config.web;

import org.courtside.api.AdminConfigApi;
import org.courtside.api.ApiAdminClubConfig;
import org.courtside.api.ApiClubConfig;
import org.courtside.api.ApiClubConfigRequest;
import org.courtside.api.ClubConfigApi;
import org.courtside.api.ManifestApi;
import org.courtside.api.ApiWebManifest;
import org.courtside.api.ApiWebManifestIcon;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.ReminderLeadTime;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.config.internal.ClubLogo;
import org.courtside.config.internal.ClubLogoNotFoundException;
import org.courtside.config.internal.ClubConfigurationSnapshot;
import org.courtside.config.internal.ConfigService;
import org.courtside.shared.SupportedLanguages;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;

import java.time.Duration;

@RestController
@RequiredArgsConstructor
class ConfigController implements ClubConfigApi, AdminConfigApi, ManifestApi {

    private final ConfigService config;
    private final SupportedLanguages languages;
    private final ConfigRequestValidator requestValidator;

    @InitBinder
    void validateRequests(WebDataBinder binder) {
        binder.addValidators(requestValidator);
    }

    @Override
    public ResponseEntity<ApiClubConfig> getClubConfig() {
        return ResponseEntity.ok(toResponse(config.current()));
    }

    @Override
    public ResponseEntity<ApiAdminClubConfig> getClubConfigForAdmin() {
        return ResponseEntity.ok(toAdminResponse(config.current()));
    }

    @Override
    public ResponseEntity<ApiAdminClubConfig> changeClubConfig(ApiClubConfigRequest request) {
        return ResponseEntity.ok(toAdminResponse(config.update(new ChangeClubConfigurationCommand(
                request.getClubName(), request.getPrimaryColor(), request.getAccentColor(),
                request.getLogoUrl(), request.getImprintUrl(), request.getPrivacyUrl(),
                request.getDefaultLocale(),
                new BookingSlotDuration(request.getSlotMinutes()), request.getTimeZone(),
                new CredentialLifetime(request.getNewAccountCredentialHours()),
                new CredentialLifetime(request.getPasswordResetCredentialHours()),
                new ReminderLeadTime(request.getBookingReminderHours()),
                request.getNoMembershipTypeRuleSetId()))));
    }

    @Override
    public ResponseEntity<Resource> getClubLogo(String version) {
        ClubLogo logo = config.logo();
        if (version != null && !version.equals(logo.digest())) {
            throw new ClubLogoNotFoundException();
        }
        ResponseEntity.BodyBuilder response = ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(logo.mediaType()))
                .cacheControl(version == null ? CacheControl.noCache()
                        : CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                .eTag('"' + logo.digest() + '"');
        return response.body(new ByteArrayResource(logo.content()));
    }

    @Override
    public ResponseEntity<ApiAdminClubConfig> uploadClubLogo(MultipartFile file) {
        try {
            return ResponseEntity.ok(toAdminResponse(config.uploadLogo(file.getBytes())));
        } catch (java.io.IOException e) {
            throw new IllegalStateException("The uploaded club logo could not be read", e);
        }
    }

    @Override
    public ResponseEntity<ApiAdminClubConfig> deleteClubLogo() {
        return ResponseEntity.ok(toAdminResponse(config.deleteLogo()));
    }

    @Override
    public ResponseEntity<ApiWebManifest> getWebManifest() {
        ClubConfigurationSnapshot configuration = config.current();
        ApiWebManifestIcon icon = configuration.logoUrl() == null
                ? new ApiWebManifestIcon("/icon.svg", "any").type("image/svg+xml")
                : new ApiWebManifestIcon(configuration.logoUrl(), "any");
        ApiWebManifest manifest = new ApiWebManifest(
                configuration.clubName(), configuration.clubName(), "/",
                ApiWebManifest.DisplayEnum.STANDALONE,
                configuration.accentColor(), configuration.primaryColor(),
                java.util.List.of(icon));
        return ResponseEntity.ok(manifest);
    }

    private ApiClubConfig toResponse(ClubConfigurationSnapshot configuration) {
        return new ApiClubConfig(
                configuration.clubName(), configuration.primaryColor(),
                configuration.accentColor(), configuration.defaultLocale(),
                languages.tags(),
                configuration.slotMinutes(), configuration.timeZone())
                .logoUrl(configuration.logoUrl())
                .imprintUrl(configuration.imprintUrl())
                .privacyUrl(configuration.privacyUrl());
    }

    private ApiAdminClubConfig toAdminResponse(ClubConfigurationSnapshot configuration) {
        return new ApiAdminClubConfig(
                configuration.clubName(), configuration.primaryColor(),
                configuration.accentColor(), configuration.defaultLocale(),
                languages.tags(),
                configuration.slotMinutes(), configuration.timeZone(),
                configuration.logoUploaded(),
                configuration.newAccountCredentialHours(),
                configuration.passwordResetCredentialHours(),
                configuration.bookingReminderHours())
                .logoUrl(configuration.logoUrl())
                .logoFallbackUrl(configuration.logoFallbackUrl())
                .imprintUrl(configuration.imprintUrl())
                .privacyUrl(configuration.privacyUrl())
                .noMembershipTypeRuleSetId(configuration.noMembershipTypeRuleSetId());
    }
}
