package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class PasswordRehashWriter {

    private final PasswordRehashRepository accounts;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void rehash(UUID accountId, String currentHash, String newHash) {
        accounts.rehashPassword(accountId, currentHash, newHash);
    }
}
