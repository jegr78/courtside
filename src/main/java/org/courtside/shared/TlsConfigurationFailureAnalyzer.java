package org.courtside.shared;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

class TlsConfigurationFailureAnalyzer
        extends AbstractFailureAnalyzer<TlsConfigurationException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure,
            TlsConfigurationException cause) {
        return new FailureAnalysis(cause.getMessage(), cause.action(), cause);
    }
}
