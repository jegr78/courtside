package org.courtside.dataexchange.internal;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.import")
public record ImportProperties(
        @NotNull @DurationMin(minutes = 1) @DurationMax(days = 30) Duration previewRetention,
        @NotNull @DurationMin(minutes = 1) @DurationMax(days = 1) Duration sweepInterval) {
}
