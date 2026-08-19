package org.courtside.securityassessment;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import java.util.regex.Pattern;

public class SecurityAssessmentEnvironmentGuard implements EnvironmentPostProcessor, Ordered {

    private static final Pattern RUN_ID = Pattern.compile("[a-z0-9][a-z0-9-]{5,47}");
    private static final Pattern LOCAL_DATABASE = Pattern.compile(
            "jdbc:postgresql://db(?::[0-9]+)?/courtside_security(?:\\?.*)?");

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (environment.acceptsProfiles(Profiles.of("security"))) {
            validate(environment);
        }
    }

    @Override
    public int getOrder() {
        return ConfigDataEnvironmentPostProcessor.ORDER + 1;
    }

    static void validate(Environment environment) {
        if (!environment.getProperty("courtside.security-assessment.confirm-disposable", Boolean.class, false)) {
            throw new IllegalStateException(
                    "COURTSIDE_SECURITY_CONFIRM_DISPOSABLE=true is required for the security profile");
        }
        if (!"SECURITY".equals(environment.getProperty("courtside.environment"))) {
            throw new IllegalStateException("The security profile requires COURTSIDE_ENVIRONMENT=SECURITY");
        }
        String runId = environment.getProperty("courtside.security-assessment.run-id");
        if (runId == null || !RUN_ID.matcher(runId).matches()) {
            throw new IllegalStateException("COURTSIDE_SECURITY_RUN_ID must identify this isolated run");
        }
        if (!SecurityAssessmentDataset.fingerprint().equals(
                environment.getProperty("courtside.security-assessment.seed-fingerprint"))) {
            throw new IllegalStateException("COURTSIDE_SECURITY_SEED_FINGERPRINT does not match this dataset");
        }
        String password = environment.getProperty("courtside.security-assessment.shared-password");
        if (password == null || password.length() < 16) {
            throw new IllegalStateException("COURTSIDE_SECURITY_SHARED_PASSWORD must contain at least 16 characters");
        }
        String databaseUrl = environment.getProperty("spring.datasource.url");
        if (databaseUrl != null && LOCAL_DATABASE.matcher(databaseUrl).matches()) {
            return;
        }
        if (databaseUrl != null && databaseUrl.matches(
                "jdbc:postgresql://[^/]+/courtside_security(?:\\?.*)?")) {
            throw new IllegalStateException("The security profile requires the Compose database host db");
        }
        throw new IllegalStateException(
                "The security profile requires a PostgreSQL database named courtside_security");
    }
}
