package org.courtside.member;

import org.courtside.shared.DomainEventRecord;

import org.courtside.identity.Role;

import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

public sealed interface RosterEvent extends DomainEventRecord {

    record PersonAdded(UUID personId) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.person.added";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record PersonCorrected(UUID personId, Set<String> fields) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.person.corrected";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record AccountCreated(UUID personId, UUID accountId, Set<Role> roles) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.account.created";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record AccountRolesChanged(UUID personId, UUID accountId, Set<Role> roles) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.account.rolesChanged";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record AccountUsernameCorrected(UUID personId, UUID accountId) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.account.usernameCorrected";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record AccountPasswordReset(UUID personId, UUID accountId) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.account.passwordReset";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record AccountAvailabilityChanged(UUID personId, UUID accountId, boolean enabled) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.account.availabilityChanged";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record MembershipWritten(UUID personId, UUID membershipTypeId, LocalDate startedOn,
                             LocalDate endedOn) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.membership.written";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }

    record MembershipEnded(UUID personId) implements RosterEvent {

        @Override
        public String eventType() {
            return "roster.membership.ended";
        }

        @Override
        public UUID subjectId() {
            return personId;
        }
    }
}
