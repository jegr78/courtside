package org.courtside.shared;

import org.jspecify.annotations.NullMarked;

import java.util.UUID;

// Nothing about the account changes when this is published; the reminder only says which name it
// signs in with, so a shared address cannot cost one holder the password another has forgotten.
@NullMarked
public record UsernameReminderRequested(UUID accountId) implements DomainEventRecord {

    static final String TYPE = "identity.account.usernameReminderRequested";

    @Override
    public String eventType() {
        return TYPE;
    }

    @Override
    public UUID subjectId() {
        return accountId;
    }
}
