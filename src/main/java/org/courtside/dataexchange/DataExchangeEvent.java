package org.courtside.dataexchange;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.List;
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

    record SourceDescribed(UUID sourceId, String sourceKey) implements DataExchangeEvent {

        static final String TYPE = "dataexchange.source.described";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return sourceId;
        }
    }

    record SourceChanged(UUID sourceId, String sourceKey, List<String> changedFields)
            implements DataExchangeEvent {

        static final String TYPE = "dataexchange.source.changed";

        public SourceChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return sourceId;
        }
    }

    record SourceDeleted(UUID sourceId, String sourceKey) implements DataExchangeEvent {

        static final String TYPE = "dataexchange.source.deleted";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return sourceId;
        }
    }

    // The member number names that person in a system this instance never erases, so the log holds
    // which source the link was against and leaves the number to the reference table.
    record ExternalReferenceLinked(UUID personId, UUID sourceId, String sourceKey)
            implements DataExchangeEvent {

        static final String TYPE = "dataexchange.externalReference.linked";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record ExternalReferenceUnlinked(UUID personId, UUID sourceId, String sourceKey)
            implements DataExchangeEvent {

        static final String TYPE = "dataexchange.externalReference.unlinked";

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
