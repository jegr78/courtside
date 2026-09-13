package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public record PasswordResetRedeemed(UUID accountId) implements DomainEventRecord {

    static final String TYPE = "identity.account.passwordResetRedeemed";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return accountId;
    }
}
