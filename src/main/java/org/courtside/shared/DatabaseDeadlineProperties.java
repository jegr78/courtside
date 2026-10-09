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
        @NotNull @DurationMin(seconds = 1) @DurationMax(minutes = 30) Duration reportTransactionTimeout,
        @NotNull @DurationMin(seconds = 1) @DurationMax(hours = 1) Duration maintenanceStatementTimeout) {

    // A statement allowed longer than its transaction never reaches its own deadline.
    DatabaseDeadlineProperties {
        if (statementTimeout != null && requestTransactionTimeout != null
                && statementTimeout.compareTo(requestTransactionTimeout) > 0) {
            throw new IllegalStateException("courtside.database.statement-timeout (" + statementTimeout
                    + ") exceeds courtside.database.request-transaction-timeout (" + requestTransactionTimeout + ")");
        }
        if (requestTransactionTimeout != null && reportTransactionTimeout != null
                && requestTransactionTimeout.compareTo(reportTransactionTimeout) > 0) {
            throw new IllegalStateException("courtside.database.request-transaction-timeout ("
                    + requestTransactionTimeout + ") exceeds courtside.database.report-transaction-timeout ("
                    + reportTransactionTimeout + ")");
        }
    }
}
