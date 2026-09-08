package org.courtside.shared;

import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.core.env.Environment;

import java.sql.SQLException;

class DatabaseRuntimeIdentityFailureAnalyzer extends AbstractFailureAnalyzer<SQLException> {

    private static final String AUTHENTICATION_REFUSED = "28P01";

    private final Environment environment;

    DatabaseRuntimeIdentityFailureAnalyzer(Environment environment) {
        this.environment = environment;
    }

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, SQLException cause) {
        if (!AUTHENTICATION_REFUSED.equals(cause.getSQLState()) || !separateIdentityEnabled()) {
            return null;
        }
        return new FailureAnalysis(
                "The separate runtime credential was refused by PostgreSQL.",
                "Replace COURTSIDE_DB_RUNTIME_PASSWORD_FILE with the current runtime credential "
                        + "and recreate the application process.",
                cause);
    }

    private boolean separateIdentityEnabled() {
        return "separate".equalsIgnoreCase(Binder.get(environment)
                .bind("courtside.database.identity.mode", String.class)
                .orElse("shared"));
    }
}
