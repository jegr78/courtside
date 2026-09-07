package org.courtside.identity.internal;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.session")
// Bounded on both sides: a value large enough never to be reached switches the guarantee off while
// the variable still reads as though it were set, and an unbounded lifetime overflows the arithmetic.
record CourtsideSessionProperties(@NotNull @DurationMin(minutes = 1) @DurationMax(days = 30)
                                  Duration absoluteLifetime,
                                  @Min(1) @Max(50) int concurrentLimit) {
}
