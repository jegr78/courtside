package org.courtside.payment.internal;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.net.URI;
import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.payment.paypal")
public record PayPalProperties(
        @NotNull URI sandboxEndpoint,
        @NotNull URI liveEndpoint,
        @NotNull @DurationMin(millis = 100) @DurationMax(minutes = 1) Duration requestTimeout) {
}
