package org.courtside.config.web;

import org.courtside.config.internal.ClubConfiguration;
import org.courtside.config.internal.ConfigService;
import org.courtside.config.web.ConfigWebModels.ConfigRequest;
import org.courtside.config.web.ConfigWebModels.ConfigResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class ConfigController {

    private final ConfigService config;

    @GetMapping("/api/public/config")
    ConfigResponse publicConfig() {
        return toResponse(config.current());
    }

    @GetMapping("/api/admin/config")
    ConfigResponse adminConfig() {
        return toResponse(config.current());
    }

    @PutMapping("/api/admin/config")
    ConfigResponse update(@Valid @RequestBody ConfigRequest request) {
        return toResponse(config.update(
                request.clubName(), request.primaryColor(), request.accentColor(),
                request.logoUrl(), request.imprintUrl(), request.defaultLocale()));
    }

    private static ConfigResponse toResponse(ClubConfiguration configuration) {
        return new ConfigResponse(
                configuration.getClubName(), configuration.getPrimaryColor(),
                configuration.getAccentColor(), configuration.getLogoUrl(),
                configuration.getImprintUrl(), configuration.getDefaultLocale());
    }
}
