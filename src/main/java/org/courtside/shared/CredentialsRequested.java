package org.courtside.shared;

import java.util.UUID;

// The event says which account needs a credential and why; it never carries one. The credential is
// generated when the message is sent, so nothing that outlives this record has ever held it.
public record CredentialsRequested(UUID accountId, Reason reason) implements DomainEventRecord {

    public enum Reason {
        NEW_ACCOUNT,
        PASSWORD_RESET
    }

    @Override
    public String eventType() {
        return "identity.account.credentialsRequested";
    }

    @Override
    public UUID subjectId() {
        return accountId;
    }
}
