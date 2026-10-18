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

    record AccountLocaleCorrected(UUID personId, UUID accountId, String locale) implements RosterEvent {

        static final String TYPE = "roster.account.localeCorrected";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record AccountCredentialsRequested(UUID personId, UUID accountId) implements RosterEvent {

        static final String TYPE = "roster.account.credentialsRequested";

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

    record MembershipWritten(UUID personId, UUID periodId, UUID membershipTypeId, LocalDate startedOn,
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

    record MembershipPeriodAdded(UUID personId, UUID periodId, UUID membershipTypeId, LocalDate startedOn,
                                 @Nullable LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.membershipPeriod.added";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record MembershipPeriodCorrected(UUID personId, UUID periodId, UUID membershipTypeId, LocalDate startedOn,
                                     @Nullable LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.membershipPeriod.corrected";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record MembershipPeriodRemoved(UUID personId, UUID periodId) implements RosterEvent {

        static final String TYPE = "roster.membershipPeriod.removed";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record GuardianshipCreated(UUID personId, UUID relationshipId, UUID guardianPersonId,
                               Set<GuardianGrant> grants, LocalDate startedOn,
                               @Nullable LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.guardianship.created";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record GuardianshipChanged(UUID personId, UUID relationshipId, UUID guardianPersonId,
                               Set<GuardianGrant> grants, @Nullable LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.guardianship.changed";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record GuardianshipEnded(UUID personId, UUID relationshipId, UUID guardianPersonId,
                             LocalDate endedOn) implements RosterEvent {

        static final String TYPE = "roster.guardianship.ended";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record GuardianshipRemoved(UUID personId, UUID relationshipId, UUID guardianPersonId) implements RosterEvent {

        static final String TYPE = "roster.guardianship.removed";

        @Override
        public String eventType() {
            return TYPE;
        }

    }
}
