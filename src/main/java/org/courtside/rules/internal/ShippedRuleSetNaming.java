package org.courtside.rules.internal;

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
class ShippedRuleSetNaming implements ApplicationRunner {

    private static final Map<UUID, String> RULE_SETS = Map.of(
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"), "ruleSet.standard",
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002"), "ruleSet.youth");

    private final RuleSetRepository ruleSets;
    private final ClubIdentity club;
    private final ShippedNames names;
    private final TransactionTemplate ownTransaction;

    ShippedRuleSetNaming(RuleSetRepository ruleSets, ClubIdentity club, ShippedNames names,
                         PlatformTransactionManager transactions) {
        this.ruleSets = ruleSets;
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
        RULE_SETS.forEach((id, key) -> ruleSets.findById(id)
                .filter(ruleSet -> names.isStillTheShippedName(key, ruleSet.getName()))
                .ifPresent(ruleSet -> rename(ruleSet, names.in(key, language))));
    }

    // Every one of these names is unique per table, so a club already using this one keeps it and
    // the row keeps the name it has. Naming is never a reason for an instance not to start.
    private void rename(RuleSet ruleSet, String name) {
        if (name.equals(ruleSet.getName())) {
            return;
        }
        ruleSet.rename(name);
        try {
            ownTransaction.executeWithoutResult(status -> ruleSets.saveAndFlush(ruleSet));
        } catch (DataIntegrityViolationException taken) {
            log.info("A shipped rule set keeps its name, because {} is already in use", name);
        }
    }
}
