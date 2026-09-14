package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Slf4j
class ShippedMembershipTypeNaming implements ApplicationRunner {

    private static final Map<UUID, String> MEMBERSHIP_TYPES = Map.of(
            UUID.fromString("cccccccc-0000-0000-0000-000000000001"), "membershipType.active",
            UUID.fromString("cccccccc-0000-0000-0000-000000000002"), "membershipType.youth");

    private final MembershipTypeRepository membershipTypes;
    private final ClubIdentity club;
    private final ShippedNames names;

    @Override
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    // The entity manager bound to the transaction that just committed is spent, so a write after
    // it needs one of its own. Startup deliberately has none: a runner that throws stops the club.
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    // A row at a time, each in its own transaction: a name one row cannot take is no reason for the
    // rest to keep theirs, and no reason at all for an instance to refuse to start.
    private void nameThemIn(String language) {
        MEMBERSHIP_TYPES.forEach((id, key) -> membershipTypes.findById(id)
                .filter(type -> names.isStillTheShippedName(key, type.getName()))
                .ifPresent(type -> rename(type, names.in(key, language))));
    }

    private void rename(MembershipType type, String name) {
        if (name.equals(type.getName()) || membershipTypes.existsByName(name)) {
            return;
        }
        type.rename(name);
        try {
            membershipTypes.saveAndFlush(type);
        } catch (DataIntegrityViolationException taken) {
            log.warn("A shipped membership type keeps its name: {} was taken meanwhile", name);
        }
    }
}
