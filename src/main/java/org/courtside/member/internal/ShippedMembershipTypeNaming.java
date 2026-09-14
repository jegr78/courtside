package org.courtside.member.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Map;
import java.util.UUID;

@Component
@Slf4j
class ShippedMembershipTypeNaming implements ApplicationRunner {

    private static final Map<UUID, String> MEMBERSHIP_TYPES = Map.of(
            UUID.fromString("cccccccc-0000-0000-0000-000000000001"), "membershipType.active",
            UUID.fromString("cccccccc-0000-0000-0000-000000000002"), "membershipType.youth");

    private final MembershipTypeRepository membershipTypes;
    private final ClubIdentity club;
    private final ShippedNames names;
    private final TransactionTemplate ownTransaction;

    ShippedMembershipTypeNaming(MembershipTypeRepository membershipTypes, ClubIdentity club,
                                ShippedNames names, PlatformTransactionManager transactions) {
        this.membershipTypes = membershipTypes;
        this.club = club;
        this.names = names;
        // One of its own per row, for two reasons: a name one row cannot take is no reason for the
        // rest to keep theirs, and after a commit the entity manager bound to it is spent.
        this.ownTransaction = new TransactionTemplate(transactions);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    @TransactionalEventListener
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    private void nameThemIn(String language) {
        MEMBERSHIP_TYPES.forEach((id, key) -> membershipTypes.findById(id)
                .filter(type -> names.isStillTheShippedName(key, type.getName()))
                .ifPresent(type -> rename(type, names.in(key, language))));
    }

    // Every one of these names is unique per table, so a club already using this one keeps it and
    // the row keeps the name it has. Naming is never a reason for an instance not to start.
    private void rename(MembershipType type, String name) {
        if (name.equals(type.getName())) {
            return;
        }
        type.rename(name);
        try {
            ownTransaction.executeWithoutResult(status -> membershipTypes.saveAndFlush(type));
        } catch (DataIntegrityViolationException taken) {
            log.info("A shipped membership type keeps its name, because {} is already in use", name);
        }
    }
}
