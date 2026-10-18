package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.GuardianRelationship;
import org.courtside.member.internal.GuardianRelationshipRepository;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Answers what a guardian may do for a dependant on a day; both must hold an account, the guardian's enabled. */
@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GuardianRelationships {

    private final GuardianRelationshipRepository relationships;
    private final UserAccountRepository accounts;

    public boolean mayActFor(UUID guardianPersonId, UUID dependantPersonId, GuardianGrant grant, LocalDate day) {
        requireAll(guardianPersonId, dependantPersonId, grant, day);
        return canSignIn(guardianPersonId) && accounts.findByPersonId(dependantPersonId).isPresent()
                && relationships.findByGuardianPersonIdAndDependantPersonId(guardianPersonId, dependantPersonId)
                .stream().anyMatch(relationship -> grants(relationship, grant, day));
    }

    public List<UUID> dependantsOf(UUID guardianPersonId, GuardianGrant grant, LocalDate day) {
        requireAll(guardianPersonId, guardianPersonId, grant, day);
        if (!canSignIn(guardianPersonId)) {
            return List.of();
        }
        return relationships.findByGuardianPersonId(guardianPersonId).stream()
                .filter(relationship -> grants(relationship, grant, day))
                .map(GuardianRelationship::getDependantPersonId)
                .distinct()
                .filter(dependant -> accounts.findByPersonId(dependant).isPresent())
                .toList();
    }

    private boolean canSignIn(UUID personId) {
        return accounts.findByPersonId(personId).map(UserAccount::isEnabled).orElse(false);
    }

    private static boolean grants(GuardianRelationship relationship, GuardianGrant grant, LocalDate day) {
        return relationship.isValidOn(day) && relationship.getGrants().contains(grant);
    }

    private static void requireAll(@Nullable UUID guardian, @Nullable UUID dependant, @Nullable GuardianGrant grant,
                                   @Nullable LocalDate day) {
        if (guardian == null || dependant == null || grant == null || day == null) {
            throw new IllegalStateException("A guardian question names both people, the action and the day");
        }
    }
}
