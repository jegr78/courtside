package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class IdentityCleanupSchedule {

    private final CredentialIssueLimit credentialIssues;
    private final LoginAttemptCleanup loginAttempts;

    @Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT1H")
    void deleteExpiredCredentialIssues() {
        credentialIssues.deleteExpiredWindows();
    }

    @Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT1H")
    void deleteExpiredLoginAttempts() {
        loginAttempts.deleteExpiredAttempts();
    }
}
