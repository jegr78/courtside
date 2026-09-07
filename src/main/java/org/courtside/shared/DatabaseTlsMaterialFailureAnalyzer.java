package org.courtside.shared;

import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

class DatabaseTlsMaterialFailureAnalyzer extends AbstractFailureAnalyzer<DatabaseTlsMaterialException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, DatabaseTlsMaterialException cause) {
        return new FailureAnalysis(cause.getMessage(),
                "Point courtside.database.tls.root-certificate at the authority that issued the"
                        + " database's certificate, or set courtside.database.tls.mode to disable"
                        + " to connect without verification.",
                cause);
    }
}
