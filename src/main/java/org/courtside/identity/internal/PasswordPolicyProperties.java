package org.courtside.identity.internal;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.net.URI;

@Validated
@ConfigurationProperties("courtside.password")
record PasswordPolicyProperties(
        @NotNull @DurationMin(millis = 100) @DurationMax(seconds = 10) Duration breachTimeout,
        @Min(1) @Max(512) int breachCacheEntries,
        @NotNull @DurationMin(minutes = 1) @DurationMax(days = 30) Duration breachCacheLifetime,
        String termsFile,
        @NotNull URI breachEndpoint) {
}
