package org.courtside.shared;

import jakarta.persistence.EntityManagerFactory;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.web.context.request.RequestContextHolder;

import java.time.Duration;

final class RequestDeadlineTransactionManager extends JpaTransactionManager {

    private final int requestTimeoutSeconds;

    RequestDeadlineTransactionManager(EntityManagerFactory entityManagerFactory, Duration requestTimeout) {
        super(entityManagerFactory);
        this.requestTimeoutSeconds = Math.toIntExact(Math.max(1, (requestTimeout.toMillis() + 999) / 1000));
    }

    // Startup, scheduled and executor work has no caller waiting, so only a request inherits the deadline.
    @Override
    protected int determineTimeout(TransactionDefinition definition) {
        if (definition.getTimeout() == TransactionDefinition.TIMEOUT_DEFAULT
                && RequestContextHolder.getRequestAttributes() != null) {
            return requestTimeoutSeconds;
        }
        return super.determineTimeout(definition);
    }
}
