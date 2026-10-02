package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@RequiredArgsConstructor
class CoordinationPreparation {

    private final ClubConfigurationRepository configurations;
    private final PlatformTransactionManager transactions;

    @EventListener(ApplicationReadyEvent.class)
    public void prepareCoordination(ApplicationReadyEvent event) {
        var transaction = new TransactionTemplate(transactions);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setTimeout(10);
        transaction.executeWithoutResult(status -> {
            status.setRollbackOnly();
            configurations.lockById(ClubConfiguration.SINGLETON_ID)
                    .orElseThrow(() -> new IllegalStateException("The club configuration row is missing"));
        });
    }
}
