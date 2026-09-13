package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// Asking changes nothing, which is why this and PasswordResetRedeemed are two records: an
// investigator has to tell a request nobody acted on from one somebody did.
@NullMarked
public record PasswordResetRequested(UUID accountId) implements DomainEventRecord {

    static final String TYPE = "identity.account.passwordResetRequested";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return accountId;
    }
}
