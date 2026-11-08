package org.courtside.credit;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public sealed interface CreditEvent extends DomainEventRecord {

    UUID accountId();

    @Override
    default UUID subjectId() {
        return accountId();
    }

    record EntryRecorded(UUID accountId, UUID entryId, CreditEntryKind kind, int amountMinor, String currency)
            implements CreditEvent {

        static final String TYPE = "credit.entry.recorded";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
