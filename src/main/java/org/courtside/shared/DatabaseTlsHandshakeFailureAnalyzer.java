package org.courtside.shared;

import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.core.env.Environment;

import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateException;
import java.security.cert.CertificateNotYetValidException;
import java.sql.SQLException;
import java.util.Set;

class DatabaseTlsHandshakeFailureAnalyzer extends AbstractFailureAnalyzer<SQLException> {

    // The driver reports a name mismatch as an ordinary connection failure, and its sentence is
    // translated, so the verifier it names is the one part of the message a locale cannot move.
    private static final String HOSTNAME_VERIFIER = "PgjdbcHostnameVerifier";
    private static final String NO_TLS = "does not support SSL";
    private static final Set<String> CONNECTION_STATES = Set.of("08004", "08006");
    private static final String REQUIRED =
            "The database connection requires a verified TLS certificate, and ";

    private final Environment environment;

    DatabaseTlsHandshakeFailureAnalyzer(Environment environment) {
        this.environment = environment;
    }

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, SQLException cause) {
        if (!verificationRequired()
                || !CONNECTION_STATES.contains(String.valueOf(cause.getSQLState()))) {
            return null;
        }
        Diagnosis diagnosis = diagnose(cause);
        return new FailureAnalysis(diagnosis.description(), diagnosis.action(), cause);
    }

    private Diagnosis diagnose(SQLException cause) {
        if (carries(cause, CertificateExpiredException.class)) {
            return new Diagnosis(REQUIRED + "the certificate the database served has expired.",
                    "Renew the database's certificate, and point courtside.database.tls"
                            + ".root-certificate at the authority that issued the new one.");
        }
        if (carries(cause, CertificateNotYetValidException.class)) {
            return new Diagnosis(REQUIRED + "the certificate the database served is not valid yet.",
                    "Compare the clocks of the two hosts, and roll the certificate out once it is"
                            + " valid.");
        }
        if (carries(cause, CertificateException.class)) {
            return new Diagnosis(REQUIRED + "the configured authority does not vouch for the"
                    + " certificate the database served.",
                    "Point courtside.database.tls.root-certificate at the authority that issued"
                            + " the database's certificate. If it already names that authority,"
                            + " what answered served a certificate nobody issued for it.");
        }
        if (String.valueOf(cause.getMessage()).contains(HOSTNAME_VERIFIER)) {
            return new Diagnosis(
                    REQUIRED + "the certificate the database served names another host.",
                    "Reissue the database's certificate for the name the connection URL uses, or"
                            + " connect under a name that certificate already carries.");
        }
        if (String.valueOf(cause.getMessage()).contains(NO_TLS)) {
            return new Diagnosis(REQUIRED + "the database offered no encryption at all.",
                    "Turn TLS on at the database, and check that the connection reaches the host"
                            + " you configured rather than something in front of it.");
        }
        return new Diagnosis("The database connection failed before any certificate could be"
                + " judged: " + cause.getMessage(),
                "Check that the database is reachable and serving TLS under the name the"
                        + " connection URL uses.");
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
                .orElse(DatabaseTlsProperties.Mode.PREFER) == DatabaseTlsProperties.Mode.VERIFY_FULL;
    }

    private record Diagnosis(String description, String action) {
    }
}
