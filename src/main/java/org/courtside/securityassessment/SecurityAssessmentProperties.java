package org.courtside.securityassessment;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("courtside.security-assessment")
record SecurityAssessmentProperties(
        boolean confirmDisposable,
        String runId,
        String seedFingerprint,
        String sharedPassword) {
}
