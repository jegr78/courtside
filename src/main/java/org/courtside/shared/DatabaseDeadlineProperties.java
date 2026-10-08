package org.courtside.shared;

import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.time.DurationMax;
import org.hibernate.validator.constraints.time.DurationMin;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties("courtside.database")
record DatabaseDeadlineProperties(
        @NotNull @DurationMin(seconds = 1) @DurationMax(minutes = 5) Duration statementTimeout,
        @NotNull @DurationMin(seconds = 1) @DurationMax(minutes = 5) Duration requestTransactionTimeout,
        @NotNull @DurationMin(seconds = 1) @DurationMax(minutes = 30) Duration reportTransactionTimeout) {
}
