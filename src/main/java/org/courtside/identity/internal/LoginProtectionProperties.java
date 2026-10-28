package org.courtside.identity.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import org.hibernate.validator.constraints.time.DurationMin;

import java.time.Duration;
import java.util.stream.Stream;

@Validated
@ConfigurationProperties("courtside.login-protection")
record LoginProtectionProperties(@NotNull @Valid Limit address,
                                 @NotNull @Valid Factor factor,
                                 @NotNull @Valid Observation global,
                                 @Min(1) int verificationConcurrency) {

    Duration retention() {
        return Stream.of(address.window().plus(address.block()), global.window())
                .max(Duration::compareTo)
                .orElseThrow();
    }

    record Limit(@Min(1) int maxFailures,
                 @NotNull @DurationMin(seconds = 1) Duration window,
                 @NotNull @DurationMin(seconds = 1) Duration block) {
    }

    record Factor(@Min(1) int maxFailures,
                  @NotNull @DurationMin(seconds = 1) Duration block,
                  @NotNull @DurationMin(seconds = 1) Duration maxBlock,
                  @NotNull @DurationMin(seconds = 1) Duration retention) {

        Duration blockAfter(int blocks) {
            Duration duration = block;
            for (int doubled = 1; doubled < blocks && duration.compareTo(maxBlock) < 0; doubled++) {
                duration = duration.multipliedBy(2);
            }
            return duration.compareTo(maxBlock) > 0 ? maxBlock : duration;
        }
    }

    record Observation(@Min(1) int threshold,
                       @NotNull @DurationMin(seconds = 1) Duration window) {
    }
}
