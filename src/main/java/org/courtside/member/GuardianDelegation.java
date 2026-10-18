package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.DependantMessageAccess;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.member.internal.DependantAccountDisabledException;
import org.courtside.member.internal.DependantNotFoundException;
import org.courtside.member.internal.GuardianActionNotGrantedException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Resolves the signed-in guardian's right to one action for a dependant, read fresh on every call. */
@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GuardianDelegation implements DependantMessageAccess {

    private final CurrentUser currentUser;
    private final GuardianRelationships relationships;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    public record Delegation(UserAccount guardian, UserAccount dependant) {

        /** The dependant's roles without the administrator override, which a guardian never wields. */
        public Set<Role> dependantRoles() {
            Set<Role> roles = dependant.getRoles().isEmpty() ? EnumSet.noneOf(Role.class)
                    : EnumSet.copyOf(dependant.getRoles());
            roles.remove(Role.ADMIN);
            return Set.copyOf(roles);
        }
    }

    public Delegation require(UUID dependantPersonId, GuardianGrant grant) {
        if (dependantPersonId == null || grant == null) {
            throw new IllegalStateException("A delegated action names the dependant and the action");
        }
        UserAccount guardian = currentUser.requireAccount();
        Optional<Set<GuardianGrant>> granted = guardian.getPerson() == null ? Optional.empty()
                : relationships.grantsFor(guardian.getPerson().getId(), dependantPersonId, today());
        if (granted.map(grants -> grants.contains(grant)).orElse(false)) {
            UserAccount dependant = relationships.accountOf(dependantPersonId).orElseThrow(
                    () -> new IllegalStateException("A granted relationship lost its dependant's account"));
            return new Delegation(guardian, dependant);
        }
        if (granted.isPresent()) {
            throw new GuardianActionNotGrantedException(grant);
        }
        throw new DependantNotFoundException(
                "Account %s acts for no person %s".formatted(guardian.getId(), dependantPersonId));
    }

    public Delegation requireBookable(UUID dependantPersonId, GuardianGrant grant) {
        Delegation delegation = require(dependantPersonId, grant);
        if (!delegation.dependant().isEnabled()) {
            throw new DependantAccountDisabledException(
                    "The account of person %s is disabled".formatted(dependantPersonId));
        }
        return delegation;
    }

    @Override
    public UserAccount requireReadableAccount(UUID dependantPersonId) {
        return require(dependantPersonId, GuardianGrant.READ_MESSAGES).dependant();
    }

    private LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), clubTimeZone.zoneId());
    }
}
