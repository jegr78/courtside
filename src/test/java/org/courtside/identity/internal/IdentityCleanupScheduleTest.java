package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class IdentityCleanupScheduleTest {

    private final CredentialIssueLimit credentialIssues = mock(CredentialIssueLimit.class);
    private final LoginAttemptCleanup loginAttempts = mock(LoginAttemptCleanup.class);
    private final IdentityCleanupSchedule schedule = new IdentityCleanupSchedule(credentialIssues, loginAttempts);

    @Test
    void whenCredentialIssueCleanupRuns_thenExpiredWindowsAreDeleted() {
        // when
        schedule.deleteExpiredCredentialIssues();

        // then
        verify(credentialIssues).deleteExpiredWindows();
    }

    @Test
    void whenLoginAttemptCleanupRuns_thenExpiredAttemptsAreDeleted() {
        // when
        schedule.deleteExpiredLoginAttempts();

        // then
        verify(loginAttempts).deleteExpiredAttempts();
    }
}
