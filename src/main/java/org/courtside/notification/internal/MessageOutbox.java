package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class MessageOutbox {

    private final MessageRecordRepository records;
    private final MessageChoices choices;
    private final MailProperties properties;
    private final MailOutbox worker;
    private final Clock clock;

    // Every message passes here, so a kind somebody switched off cannot be queued by a mailer that
    // forgot to ask.
    @Transactional(propagation = Propagation.MANDATORY)
    public void queue(UUID accountId, MessageKind kind, Map<String, String> parameters) {
        if (!choices.wants(accountId, kind)) {
            log.info("A {} message was not queued: account {} does not want it", kind, accountId);
            return;
        }
        String messageId = MailDispatch.newMessageId(MailSettings.senderDomain(properties.from()));
        records.save(new MessageRecord(accountId, kind, messageId, clock.instant(), parameters));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                worker.wake();
            }
        });
    }
}
