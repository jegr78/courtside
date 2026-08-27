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
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class SubjectAccessService {

    private final PersonRepository persons;
    private final UserAccountRepository accounts;
    private final MemberRepository members;
    private final MemberService membershipTypes;
    private final ExternalReferenceRepository references;
    private final PersonBookingHistory bookings;
    private final PersonAuditTrail auditTrail;
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
        Optional<UserAccount> account = accounts.findByPersonId(personId);
        SubjectAccessRecord answer = new SubjectAccessRecord(now, person.getId(),
                person.getFirstName(), person.getLastName(), person.getEmail(),
                account.map(held -> accountOf(held, now)).orElse(null),
                membershipsOf(personId),
                account.map(UserAccount::getId).map(bookings::madeBy).orElse(List.of()),
                bookings.recordedIn(personId),
                referencesOf(personId),
                changesAbout(personId, account.map(UserAccount::getId).orElse(null)),
                account.map(UserAccount::getId).map(auditTrail::recordedBy).orElse(List.of()));
        events.publishEvent(new DataExchangeEvent.SubjectAccessAnswered(personId));
        log.info("Answered a subject access request about person {}", personId);
        return answer;
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
    private List<PersonAuditTrail.SubjectEntry> changesAbout(UUID personId, UUID accountId) {
        List<PersonAuditTrail.SubjectEntry> entries =
                new ArrayList<>(auditTrail.recordedAbout(personId));
        if (accountId != null) {
            entries.addAll(auditTrail.recordedAbout(accountId));
        }
        entries.sort(Comparator.comparing(PersonAuditTrail.SubjectEntry::occurredAt)
                .thenComparing(PersonAuditTrail.SubjectEntry::eventType));
        return List.copyOf(entries);
    }
}
