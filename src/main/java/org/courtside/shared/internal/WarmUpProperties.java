package org.courtside.shared.internal;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.warm-up")
record WarmUpProperties(
        boolean enabled,
        @NotNull @DurationMin(seconds = 1) @DurationMax(minutes = 5) Duration deadline) {
}
