package org.courtside.identity.internal;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.session")
// The upper bound is the point: without one, a value large enough to never be reached switches the
// guarantee off silently, and one large enough to overflow the arithmetic turns every request into a 500.
record SessionLifetimeProperties(@NotNull @DurationMin(minutes = 1) @DurationMax(days = 30)
                                 Duration absoluteLifetime) {
}
