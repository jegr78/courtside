package org.courtside.shared;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

class DatabaseIdentityFailureAnalyzer
        extends AbstractFailureAnalyzer<DatabaseIdentityConfigurationException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure,
            DatabaseIdentityConfigurationException cause) {
        return new FailureAnalysis(cause.getMessage(), cause.action(), cause);
    }
}
