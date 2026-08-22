package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// The event says which account needs a credential and why; it never carries one. The credential is
// generated when the message is sent, so nothing that outlives this record has ever held it.
@NullMarked
public record CredentialsRequested(UUID accountId, Reason reason) implements DomainEventRecord {

    static final String TYPE = "identity.account.credentialsRequested";

    public enum Reason {
        NEW_ACCOUNT,
        PASSWORD_RESET
    }

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return accountId;
    }
}
