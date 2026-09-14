package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
@Order(1)
class ShippedMembershipTypeNaming implements ApplicationRunner {

    private static final Map<UUID, String> MEMBERSHIP_TYPES = Map.of(
            UUID.fromString("cccccccc-0000-0000-0000-000000000001"), "membershipType.active",
            UUID.fromString("cccccccc-0000-0000-0000-000000000002"), "membershipType.youth");

    private final MembershipTypeRepository membershipTypes;
    private final ClubIdentity club;
    private final ShippedNames names;

    @Override
    @Transactional
    public void run(ApplicationArguments arguments) {
        nameThemIn(club.defaultLocale());
    }

    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    void whenTheClubChangesItsLanguage(ConfigEvent.LocaleChanged changed) {
        nameThemIn(changed.defaultLocale());
    }

    private void nameThemIn(String language) {
        MEMBERSHIP_TYPES.forEach((id, key) -> membershipTypes.findById(id)
                .filter(type -> names.isStillTheShippedName(key, type.getName()))
                .ifPresent(type -> type.rename(names.in(key, language))));
    }
}
