package org.courtside.dataexchange;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public sealed interface DataExchangeEvent extends DomainEventRecord {

    // The record says that an answer was produced and about whom. What was in it is the person's
    // own data, and a change log that repeated it would hold a second copy nobody asked for.
    record SubjectAccessAnswered(UUID personId) implements DataExchangeEvent {

        static final String TYPE = "dataexchange.subjectAccess.answered";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }
}
