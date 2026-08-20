package org.courtside.member;

import org.courtside.shared.DomainEventRecord;

import java.util.List;
import java.util.UUID;

public sealed interface MembershipTypeEvent extends DomainEventRecord {

    UUID membershipTypeId();

    @Override
    default UUID subjectId() {
        return membershipTypeId();
    }

    record Added(UUID membershipTypeId, UUID ruleSetId) implements MembershipTypeEvent {

        static final String TYPE = "roster.membershipType.added";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record Changed(UUID membershipTypeId, UUID ruleSetId, List<String> changedFields)
            implements MembershipTypeEvent {

        static final String TYPE = "roster.membershipType.changed";

        public Changed {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AvailabilityChanged(UUID membershipTypeId, boolean active) implements MembershipTypeEvent {

        static final String TYPE = "roster.membershipType.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }
}
