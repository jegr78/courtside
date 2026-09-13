package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

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
