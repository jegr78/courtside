package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class SignInRecorder {

    private final SignInRecordRepository accounts;
    private final Clock clock;

    @Transactional
    void signedIn(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A sign-in cannot be recorded without an account");
        }
        accounts.recordSignIn(accountId, clock.instant());
    }
}
