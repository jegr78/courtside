package org.courtside.identity.internal;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.session")
record SessionLifetimeProperties(@NotNull @DurationMin(minutes = 1) Duration absoluteLifetime) {
}
