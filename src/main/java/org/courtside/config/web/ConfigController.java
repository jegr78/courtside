package org.courtside.config.web;

import org.courtside.api.AdminConfigApi;
import org.courtside.api.ApiClubConfig;
import org.courtside.api.ApiClubConfigRequest;
import org.courtside.api.ClubConfigApi;
import org.courtside.api.ManifestApi;
import org.courtside.api.ApiWebManifest;
import org.courtside.api.ApiWebManifestIcon;
import org.courtside.config.internal.ClubConfiguration;
import org.courtside.config.internal.ConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;

@RestController
@RequiredArgsConstructor
class ConfigController implements ClubConfigApi, AdminConfigApi, ManifestApi {

    private final ConfigService config;
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
    public ResponseEntity<ApiClubConfig> getClubConfigForAdmin() {
        return ResponseEntity.ok(toResponse(config.current()));
    }

    @Override
    public ResponseEntity<ApiClubConfig> changeClubConfig(ApiClubConfigRequest request) {
        return ResponseEntity.ok(toResponse(config.update(
                request.getClubName(), request.getPrimaryColor(), request.getAccentColor(),
                request.getLogoUrl(), request.getImprintUrl(), request.getDefaultLocale(),
                request.getSlotMinutes())));
    }

    @Override
    public ResponseEntity<ApiWebManifest> getWebManifest() {
        ClubConfiguration configuration = config.current();
        ApiWebManifestIcon icon = configuration.getLogoUrl() == null
                ? new ApiWebManifestIcon("/icon.svg", "any").type("image/svg+xml")
                : new ApiWebManifestIcon(configuration.getLogoUrl(), "any");
        ApiWebManifest manifest = new ApiWebManifest(
                configuration.getClubName(), configuration.getClubName(), "/",
                ApiWebManifest.DisplayEnum.STANDALONE,
                configuration.getAccentColor(), configuration.getPrimaryColor(),
                java.util.List.of(icon));
        return ResponseEntity.ok(manifest);
    }

    private static ApiClubConfig toResponse(ClubConfiguration configuration) {
        return new ApiClubConfig(
                configuration.getClubName(), configuration.getPrimaryColor(),
                configuration.getAccentColor(), configuration.getDefaultLocale(),
                configuration.getSlotMinutes())
                .logoUrl(configuration.getLogoUrl())
                .imprintUrl(configuration.getImprintUrl());
    }
}
