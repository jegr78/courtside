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

    // A row deleted while its window still runs restarts the count, so the limit would stop binding
    // without anything reporting it.
    CredentialIssueProperties {
        if (window != null && retention != null && retention.compareTo(window) < 0) {
            throw new IllegalStateException("courtside.credential-issue.retention (" + retention
                    + ") must not be shorter than the window (" + window + ")");
        }
    }
}
