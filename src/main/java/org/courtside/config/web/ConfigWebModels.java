package org.courtside.config.web;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

final class ConfigWebModels {

    private ConfigWebModels() {
    }

    record ConfigResponse(
            String clubName,
            String primaryColor,
            String accentColor,
            String logoUrl,
            String imprintUrl,
            String defaultLocale) {
    }

    record ConfigRequest(
            @NotBlank @Size(max = 100) String clubName,
            @NotBlank @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String primaryColor,
            @NotBlank @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String accentColor,
            @Size(max = 500) @Pattern(regexp = "^(https?://.+|/[^/\\\\].*|/)$") String logoUrl,
            @Size(max = 500) @Pattern(regexp = "^(https?://.+|/[^/\\\\].*|/)$") String imprintUrl,
            @NotBlank @Pattern(regexp = "^(de|en)$") String defaultLocale) {
    }
}
