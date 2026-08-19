package org.courtside.audit.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.shared.DomainEventRecord;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class DomainEventWriter {

    private final DomainEventRepository events;
    private final ObjectMapper json;
    private final CurrentUser currentUser;
    private final Clock clock;

    // Before the commit, so a change that cannot be recorded is a change that does not happen.
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    void record(DomainEventRecord event) {
        events.save(new DomainEvent(event.eventType(), event.subjectId(), actor(),
                clock.instant(), json.writeValueAsString(event)));
    }

    private UUID actor() {
        return currentUser.accountId().orElse(null);
    }
}
