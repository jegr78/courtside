package org.courtside.dataexchange.internal;

import org.courtside.audit.PersonAuditTrail;
import org.courtside.booking.PersonBookingHistory;
import org.courtside.notification.PersonMessageHistory;
import org.courtside.identity.CredentialState;
import org.courtside.identity.Role;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record SubjectAccessRecord(Instant producedAt, UUID personId, String firstName,
                                  String lastName, @Nullable String email, List<Account> accounts,
                                  List<Membership> memberships,
                                  List<PersonBookingHistory.Made> bookingsMade,
                                  List<PersonBookingHistory.Recorded> bookingsRecordedIn,
                                  List<PersonBookingHistory.Series> bookingSeries,
                                  List<PersonMessageHistory.Message> messages,
                                  List<PersonMessageHistory.Declined> declinedMessages,
                                  List<Reference> externalReferences,
                                  List<PersonAuditTrail.SubjectEntry> changesAsSubject,
                                  List<PersonAuditTrail.ActorEntry> changesAsActor) {

    public record Account(UUID accountId, String username, String locale, boolean enabled,
                          Instant createdAt, boolean passwordChangeRequired,
                          @Nullable Instant credentialsExpireAt, CredentialState credentialState,
                          Set<Role> roles) {
    }

    public record Membership(UUID membershipTypeId, @Nullable String membershipType,
                             @Nullable LocalDate startedOn, @Nullable LocalDate endedOn) {
    }

    public record Reference(UUID sourceId, String externalId, Instant linkedAt) {
    }
}
