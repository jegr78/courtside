package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.audit.PersonAuditTrail;
import org.courtside.booking.PersonBookingHistory;
import org.courtside.dataexchange.DataExchangeEvent;
import org.courtside.dataexchange.SubjectAccessPersonNotFoundException;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.member.MemberService;
import org.courtside.notification.PersonMessageHistory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class SubjectAccessService {

    private static final Comparator<UserAccount> ACCOUNT_PRECEDENCE =
            Comparator.comparing(UserAccount::isEnabled, Comparator.reverseOrder())
                    .thenComparing(UserAccount::getCreatedAt)
                    .thenComparing(UserAccount::getId);

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final MemberService membershipTypes;
    private final ExternalReferenceRepository references;
    private final PersonBookingHistory bookings;
    private final PersonAuditTrail auditTrail;
    private final PersonMessageHistory messages;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    // Writing, although every read in it is a read: answering is itself a processing activity, and
    // the entry that records it has to commit with the answer that caused it.
    @Transactional
    public SubjectAccessRecord answerFor(UUID personId) {
        if (personId == null) {
            throw new SubjectAccessPersonNotFoundException("A subject access answer needs a person");
        }
        Person person = persons.findById(personId)
                .orElseThrow(() -> new SubjectAccessPersonNotFoundException(
                        "No person with id " + personId));
        Instant now = clock.instant();
        // Every account, not the one that represents the person elsewhere: this instance holds
        // both, and an answer that named one of them would be the incomplete kind.
        List<UUID> accountIds = accounts.findByPersonIdIn(List.of(personId)).stream()
                .sorted(ACCOUNT_PRECEDENCE)
                .map(UserAccount::getId)
                .toList();
        List<PersonBookingHistory.Made> made = eachAccount(accountIds, bookings::madeBy);
        SubjectAccessRecord answer = new SubjectAccessRecord(now, person.getId(),
                person.getFirstName(), person.getLastName(), person.getEmail(),
                accounts.findByPersonIdIn(List.of(personId)).stream()
                        .sorted(ACCOUNT_PRECEDENCE)
                        .map(held -> accountOf(held, now))
                        .toList(),
                membershipsOf(personId), made, recordedInSomebodyElses(personId, made),
                eachAccount(accountIds, bookings::seriesCreatedBy),
                eachAccount(accountIds, messages::sentTo),
                eachAccount(accountIds, messages::declinedBy),
                referencesOf(personId),
                changesAbout(personId, accountIds),
                eachAccount(accountIds, auditTrail::recordedBy));
        events.publishEvent(new DataExchangeEvent.SubjectAccessAnswered(personId));
        log.info("Answered a subject access request about person {}", personId);
        return answer;
    }

    private static <T> List<T> eachAccount(List<UUID> accountIds,
                                           Function<UUID, List<T>> read) {
        return accountIds.stream().map(read).flatMap(List::stream).toList();
    }

    // A booking is answered once: whoever makes one is recorded in it as its first participant,
    // and the list of what somebody else recorded them in is not the place to say so a second time.
    private List<PersonBookingHistory.Recorded> recordedInSomebodyElses(
            UUID personId, List<PersonBookingHistory.Made> made) {
        Set<UUID> own = made.stream().map(PersonBookingHistory.Made::bookingId)
                .collect(Collectors.toSet());
        return bookings.recordedIn(personId).stream()
                .filter(booking -> !own.contains(booking.bookingId()))
                .toList();
    }

    private SubjectAccessRecord.Account accountOf(UserAccount account, Instant now) {
        return new SubjectAccessRecord.Account(account.getId(), account.getUsername(),
                account.getLocale(), account.isEnabled(), account.getCreatedAt(),
                account.isPasswordChangeRequired(), account.getCredentialsExpireAt(),
                account.credentialState(now), account.getRoles());
    }

    private List<SubjectAccessRecord.Membership> membershipsOf(UUID personId) {
        return members.findByPersonId(personId)
                .map(this::membershipOf)
                .map(List::of)
                .orElse(List.of());
    }

    private SubjectAccessRecord.Membership membershipOf(Member member) {
        return new SubjectAccessRecord.Membership(member.getMembershipTypeId(),
                membershipTypes.membershipTypeNameOf(member.getMembershipTypeId()).orElse(null),
                member.getStartedOn(), member.getEndedOn());
    }

    private List<SubjectAccessRecord.Reference> referencesOf(UUID personId) {
        return references.findByPersonIdOrderByLinkedAtAscIdAsc(personId).stream()
                .map(reference -> new SubjectAccessRecord.Reference(reference.getSourceId(),
                        reference.getExternalId(), reference.getLinkedAt()))
                .toList();
    }

    // The account is a subject of its own: a credential this person was sent is recorded against
    // the account id, not against the person the account belongs to.
    private List<PersonAuditTrail.SubjectEntry> changesAbout(UUID personId, List<UUID> accountIds) {
        List<PersonAuditTrail.SubjectEntry> entries =
                new ArrayList<>(auditTrail.recordedAbout(personId));
        accountIds.forEach(accountId -> entries.addAll(auditTrail.recordedAbout(accountId)));
        entries.sort(Comparator.comparing(PersonAuditTrail.SubjectEntry::occurredAt)
                .thenComparing(PersonAuditTrail.SubjectEntry::eventType));
        return List.copyOf(entries);
    }
}
