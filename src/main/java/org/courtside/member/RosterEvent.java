package org.courtside.member;

import org.courtside.identity.Role;
import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

@NullMarked
public sealed interface RosterEvent extends DomainEventRecord {

    UUID personId();

    @Override
    default UUID subjectId() {
        return personId();
    }

    record PersonAdded(UUID personId) implements RosterEvent {

        static final String TYPE = "roster.person.added";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record PersonCorrected(UUID personId, Set<String> fields) implements RosterEvent {

        static final String TYPE = "roster.person.corrected";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountCreated(UUID personId, UUID accountId, Set<Role> roles) implements RosterEvent {

        static final String TYPE = "roster.account.created";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountRolesChanged(UUID personId, UUID accountId, Set<Role> roles) implements RosterEvent {

        static final String TYPE = "roster.account.rolesChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountUsernameCorrected(UUID personId, UUID accountId) implements RosterEvent {

        static final String TYPE = "roster.account.usernameCorrected";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountPasswordReset(UUID personId, UUID accountId) implements RosterEvent {

        static final String TYPE = "roster.account.passwordReset";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountAvailabilityChanged(UUID personId, UUID accountId, boolean enabled) implements RosterEvent {

        static final String TYPE = "roster.account.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record MembershipWritten(UUID personId, UUID membershipTypeId, @Nullable LocalDate startedOn,
                             @Nullable LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.membership.written";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record MembershipEnded(UUID personId) implements RosterEvent {

        static final String TYPE = "roster.membership.ended";

        @Override
        public String eventType() {
            return TYPE;
        }

    }
}
