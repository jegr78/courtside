package org.courtside.identity.internal;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.credential-issue")
record CredentialIssueProperties(@Min(1) int maxPerWindow,
                                 @NotNull @DurationMin(seconds = 1) Duration window,
                                 @NotNull @DurationMin(seconds = 1) Duration retention) {
}
