package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.GuardianRelationship;
import org.courtside.member.internal.GuardianRelationshipRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** Answers what a guardian may do for a dependant on a day; both must hold an account, the guardian's enabled. */
@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
class GuardianRelationships {

    private final GuardianRelationshipRepository relationships;
    private final UserAccountRepository accounts;

    /** The actions granted on the day, or empty when no relationship between the two holds then. */
    Optional<Set<GuardianGrant>> grantsFor(UUID guardianPersonId, UUID dependantPersonId, LocalDate day) {
        if (guardianPersonId == null || dependantPersonId == null || day == null) {
            throw new IllegalStateException("A guardian question names both people and the day");
        }
        if (!canSignIn(guardianPersonId) || accountOf(dependantPersonId).isEmpty()) {
            return Optional.empty();
        }
        return relationships.findByGuardianPersonIdAndDependantPersonId(guardianPersonId, dependantPersonId)
                .stream()
                .filter(relationship -> relationship.isValidOn(day))
                .findFirst()
                .map(relationship -> Set.copyOf(relationship.getGrants()));
    }

    /** The relationships holding on the day through which the guardian may act, each with a dependant account. */
    List<GuardianRelationship> runningFor(UUID guardianPersonId, LocalDate day) {
        if (guardianPersonId == null || day == null) {
            throw new IllegalStateException("A guardian question names the guardian and the day");
        }
        if (!canSignIn(guardianPersonId)) {
            return List.of();
        }
        List<GuardianRelationship> running = relationships.findByGuardianPersonId(guardianPersonId).stream()
                .filter(relationship -> relationship.isValidOn(day))
                .toList();
        Set<UUID> withAccount = accounts.findByPersonIdIn(running.stream()
                        .map(GuardianRelationship::getDependantPersonId).toList()).stream()
                .map(account -> account.getPerson().getId())
                .collect(Collectors.toSet());
        return running.stream()
                .filter(relationship -> withAccount.contains(relationship.getDependantPersonId()))
                .toList();
    }

    /** The account a person acts through: an enabled one first, the same one on every call. */
    Optional<UserAccount> accountOf(UUID personId) {
        return accounts.findByPersonIdIn(List.of(personId)).stream()
                .min(Comparator.comparing((UserAccount account) -> !account.isEnabled())
                        .thenComparing(UserAccount::getId));
    }

    private boolean canSignIn(UUID personId) {
        return accountOf(personId).map(UserAccount::isEnabled).orElse(false);
    }
}
