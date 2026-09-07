package org.courtside.identity.internal;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("courtside.session")
// An upper bound as well as a lower one: a limit large enough never to be reached is the policy
// switched off while still looking configured.
record SessionLimitProperties(@Min(1) @Max(50) int concurrentLimit) {
}
