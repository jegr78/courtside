package org.courtside.rules.internal;

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
class ShippedRuleSetNaming implements ApplicationRunner {

    private static final Map<UUID, String> RULE_SETS = Map.of(
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"), "ruleSet.standard",
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002"), "ruleSet.youth");

    private final RuleSetRepository ruleSets;
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
        RULE_SETS.forEach((id, key) -> ruleSets.findById(id)
                .filter(ruleSet -> names.isStillTheShippedName(key, ruleSet.getName()))
                .ifPresent(ruleSet -> ruleSet.rename(names.in(key, language))));
    }
}
