package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminSubjectAccessApi;
import org.courtside.api.ApiBookingStatus;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiSubjectAccessAccount;
import org.courtside.api.ApiSubjectAccessAction;
import org.courtside.api.ApiSubjectAccessBooking;
import org.courtside.api.ApiSubjectAccessChange;
import org.courtside.api.ApiSubjectAccessExport;
import org.courtside.api.ApiSubjectAccessExternalReference;
import org.courtside.api.ApiSubjectAccessMembership;
import org.courtside.api.ApiSubjectAccessParticipation;
import org.courtside.api.ApiSubjectAccessReservation;
import org.courtside.audit.PersonAuditTrail;
import org.courtside.booking.PersonBookingHistory;
import org.courtside.dataexchange.internal.SubjectAccessRecord;
import org.courtside.dataexchange.internal.SubjectAccessService;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class SubjectAccessAdminController implements AdminSubjectAccessApi {

    private final SubjectAccessService subjectAccess;

    @Override
    public ResponseEntity<ApiSubjectAccessExport> exportPersonData(UUID personId) {
        return ResponseEntity.ok(toResponse(subjectAccess.answerFor(personId)));
    }

    private static ApiSubjectAccessExport toResponse(SubjectAccessRecord answer) {
        return new ApiSubjectAccessExport(WireTypes.toOffsetDateTime(answer.producedAt()),
                answer.personId(), answer.firstName(), answer.lastName(),
                answer.memberships().stream().map(SubjectAccessAdminController::toMembership).toList(),
                answer.bookingsMade().stream().map(SubjectAccessAdminController::toBooking).toList(),
                answer.bookingsRecordedIn().stream()
                        .map(SubjectAccessAdminController::toParticipation).toList(),
                answer.externalReferences().stream()
                        .map(SubjectAccessAdminController::toReference).toList(),
                answer.changesAsSubject().stream().map(SubjectAccessAdminController::toChange).toList(),
                answer.changesAsActor().stream().map(SubjectAccessAdminController::toAction).toList())
                .email(answer.email())
                .account(toAccount(answer.account()));
    }

    private static ApiSubjectAccessAccount toAccount(SubjectAccessRecord.Account account) {
        if (account == null) {
            return null;
        }
        return new ApiSubjectAccessAccount(account.accountId(), account.username(), account.locale(),
                account.enabled(), WireTypes.toOffsetDateTime(account.createdAt()),
                ApiSubjectAccessAccount.CredentialStateEnum.fromValue(account.credentialState().name()),
                account.roles().stream().map(role -> ApiRole.fromValue(role.name())).sorted().toList())
                .passwordChangeRequired(account.passwordChangeRequired())
                .credentialsExpireAt(WireTypes.toOffsetDateTime(account.credentialsExpireAt()));
    }

    private static ApiSubjectAccessMembership toMembership(SubjectAccessRecord.Membership membership) {
        return new ApiSubjectAccessMembership(membership.membershipTypeId(), membership.membershipType())
                .startedOn(membership.startedOn())
                .endedOn(membership.endedOn());
    }

    private static ApiSubjectAccessBooking toBooking(PersonBookingHistory.Made booking) {
        return new ApiSubjectAccessBooking(booking.bookingId(),
                WireTypes.toOffsetDateTime(booking.createdAt()),
                ApiBookingStatus.fromValue(booking.status().name()),
                toReservations(booking.reservations()))
                .cancelledAt(WireTypes.toOffsetDateTime(booking.cancelledAt()))
                .note(booking.note());
    }

    private static ApiSubjectAccessParticipation toParticipation(PersonBookingHistory.Recorded booking) {
        return new ApiSubjectAccessParticipation(booking.bookingId(),
                ApiBookingStatus.fromValue(booking.status().name()),
                toReservations(booking.reservations()));
    }

    private static List<ApiSubjectAccessReservation> toReservations(
            List<PersonBookingHistory.Reservation> reservations) {
        return reservations.stream()
                .map(reservation -> new ApiSubjectAccessReservation(reservation.courtId(),
                        WireTypes.toOffsetDateTime(reservation.startsAt()),
                        WireTypes.toOffsetDateTime(reservation.endsAt())))
                .toList();
    }

    private static ApiSubjectAccessExternalReference toReference(SubjectAccessRecord.Reference reference) {
        return new ApiSubjectAccessExternalReference(reference.sourceId(), reference.externalId(),
                WireTypes.toOffsetDateTime(reference.linkedAt()));
    }

    private static ApiSubjectAccessChange toChange(PersonAuditTrail.SubjectEntry entry) {
        return new ApiSubjectAccessChange(WireTypes.toOffsetDateTime(entry.occurredAt()),
                entry.eventType(), entry.parameters());
    }

    private static ApiSubjectAccessAction toAction(PersonAuditTrail.ActorEntry entry) {
        return new ApiSubjectAccessAction(WireTypes.toOffsetDateTime(entry.occurredAt()),
                entry.eventType());
    }
}
