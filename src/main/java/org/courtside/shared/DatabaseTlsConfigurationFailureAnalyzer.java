package org.courtside.shared;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

class DatabaseTlsConfigurationFailureAnalyzer
        extends AbstractFailureAnalyzer<DatabaseTlsConfigurationException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure,
            DatabaseTlsConfigurationException cause) {
        return new FailureAnalysis(cause.getMessage(), cause.action(), cause);
    }
}
