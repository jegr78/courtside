package org.courtside.config.web;

import org.courtside.api.AdminConfigApi;
import org.courtside.api.ApiClubConfig;
import org.courtside.api.ApiClubConfigRequest;
import org.courtside.api.ClubConfigApi;
import org.courtside.config.internal.ClubConfiguration;
import org.courtside.config.internal.ConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class ConfigController implements ClubConfigApi, AdminConfigApi {

    private final ConfigService config;

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
                request.getLogoUrl(), request.getImprintUrl(), request.getDefaultLocale())));
    }

    private static ApiClubConfig toResponse(ClubConfiguration configuration) {
        return new ApiClubConfig(
                configuration.getClubName(), configuration.getPrimaryColor(),
                configuration.getAccentColor(), configuration.getDefaultLocale())
                .logoUrl(configuration.getLogoUrl())
                .imprintUrl(configuration.getImprintUrl());
    }
}
