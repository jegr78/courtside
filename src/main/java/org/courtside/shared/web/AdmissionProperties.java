package org.courtside.shared.web;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.util.Map;

@Validated
@ConfigurationProperties("courtside.admission")
record AdmissionProperties(@NotNull @Valid Limit account,
                           @NotNull @Valid Limit address,
                           @Min(1) int trackedPrincipals,
                           @NotNull Duration bulkheadWait,
                           @NotNull Map<String, @NotNull @Valid DemandClass> classes) {

    record Limit(@Min(1) int burst, @Min(1) int perSecond) {

        RequestBudget budget() {
            return new RequestBudget(burst, perSecond);
        }
    }

    // A class without concurrency is a decision that only its cost bounds it.
    record DemandClass(@Min(1) int cost, @Min(1) Integer concurrency) {
    }
}
