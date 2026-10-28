package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.UserAccountRepository;
import org.courtside.notification.MessageChannel;
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
    private final MessageChannels channels;
    private final NotificationInbox inbox;
    private final UserAccountRepository accounts;
    private final MailProperties properties;
    private final MailOutbox worker;
    private final Clock clock;

    // Every message passes here, so a kind somebody switched off cannot be queued by a mailer that
    // forgot to ask, and the centre holds whatever a member was told on any channel.
    @Transactional(propagation = Propagation.MANDATORY)
    public void queue(UUID accountId, MessageKind kind, Map<String, String> parameters) {
        enqueue(accountId, kind, parameters, null);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void queueToPreviousAddress(UUID accountId, MessageKind kind, String previousAddress) {
        if (previousAddress == null || previousAddress.isBlank()) {
            throw new IllegalStateException("A notice to a previous address needs that address");
        }
        enqueue(accountId, kind, Map.of(), previousAddress);
    }

    private void enqueue(UUID accountId, MessageKind kind, Map<String, String> parameters, String previousAddress) {
        if (!choices.wants(accountId, kind)) {
            log.info("A {} message was not queued: account {} does not want it", kind, accountId);
            return;
        }
        inbox.record(accountId, kind, parameters);
        if (!kind.isAlwaysMailed() && !mailable(accountId)) {
            log.info("A {} message stays in the centre: account {} takes no mail", kind, accountId);
            return;
        }
        String messageId = MailDispatch.newMessageId(MailSettings.senderDomain(properties.from()));
        records.save(new MessageRecord(accountId, kind, messageId, clock.instant(), parameters, previousAddress));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                worker.wake();
            }
        });
    }

    private boolean mailable(UUID accountId) {
        return channels.wants(accountId, MessageChannel.EMAIL)
                && MessageRecipient.reachable(accounts.findById(accountId)).isPresent();
    }
}
