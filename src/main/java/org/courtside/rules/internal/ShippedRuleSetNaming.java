package org.courtside.rules.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubIdentity;
import org.courtside.config.ConfigEvent;
import org.courtside.shared.ShippedNames;
import org.courtside.shared.SqlConstraintViolation;
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

    private static final String UNIQUE_RULE_SET_NAME = "rule_set_unique_name";

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
        RULE_SETS.forEach((id, key) -> nameOrKeepTakenName(
                () -> ruleSets.nameShippedRuleSet(id, names.in(key, language),
                        names.everyLanguage(key)), key));
    }

    // A name already in use is the one failure naming expects, and it is never a reason for an
    // instance not to start; any other violation is this image's own bug rather than a club's data.
    private void nameOrKeepTakenName(Runnable name, String key) {
        try {
            ownTransaction.executeWithoutResult(status -> name.run());
        } catch (DataIntegrityViolationException e) {
            if (!SqlConstraintViolation.matches(
                    e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_RULE_SET_NAME)) {
                throw e;
            }
            log.info("The shipped row {} keeps the name it has, because the one its club's language"
                    + " gives it is already in use", key);
        }
    }
}
