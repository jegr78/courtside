package org.courtside.shared;

import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.core.env.Environment;

import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateException;
import java.sql.SQLException;
import java.util.Set;

class DatabaseTlsHandshakeFailureAnalyzer extends AbstractFailureAnalyzer<SQLException> {

    // The driver reports a name mismatch as an ordinary connection failure, and its sentence is
    // translated, so the verifier it names is the one part of the message a locale cannot move.
    private static final String HOSTNAME_VERIFIER = "PgjdbcHostnameVerifier";
    private static final Set<String> CONNECTION_STATES = Set.of("08004", "08006");
    private static final String ACTION = "Reissue the database's certificate for the name the"
            + " connection URL uses, point courtside.database.tls.root-certificate at the authority"
            + " that signed it, or set courtside.database.tls.mode to disable.";

    private final Environment environment;

    DatabaseTlsHandshakeFailureAnalyzer(Environment environment) {
        this.environment = environment;
    }

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, SQLException cause) {
        if (!verificationRequired() || !CONNECTION_STATES.contains(cause.getSQLState())) {
            return null;
        }
        return new FailureAnalysis(described(cause), ACTION, cause);
    }

    private String described(SQLException cause) {
        String required = "The database connection requires a verified TLS certificate, and ";
        if (carries(cause, CertificateExpiredException.class)) {
            return required + "the certificate the database served has expired.";
        }
        if (carries(cause, CertificateException.class)) {
            return required + "the configured authority does not vouch for the certificate the"
                    + " database served.";
        }
        if (String.valueOf(cause.getMessage()).contains(HOSTNAME_VERIFIER)) {
            return required + "the certificate the database served names another host.";
        }
        return required + "the connection failed: " + cause.getMessage();
    }

    private static boolean carries(Throwable failure, Class<? extends Throwable> kind) {
        for (Throwable step = failure; step != null && step != step.getCause();
                step = step.getCause()) {
            if (kind.isInstance(step)) {
                return true;
            }
        }
        return false;
    }

    private boolean verificationRequired() {
        return Binder.get(environment)
                .bind("courtside.database.tls.mode", DatabaseTlsProperties.Mode.class)
                .orElse(DatabaseTlsProperties.Mode.DISABLE) == DatabaseTlsProperties.Mode.VERIFY_FULL;
    }
}
