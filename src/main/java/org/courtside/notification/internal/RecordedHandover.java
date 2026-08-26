package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class RecordedHandover {

    private final MailDispatch dispatch;
    private final MailHandover handover;
    private final MailProperties properties;
    private final MessageChoices choices;
    private final MessageLog messages;

    // Every message this instance sends passes here, so a kind somebody switched off cannot be
    // written by a mailer that forgot to ask.
    void handOver(UUID accountId, MessageKind kind, String address, String subject, String body) {
        if (!choices.wants(accountId, kind)) {
            log.info("A {} message was not sent: account {} does not want it", kind, accountId);
            return;
        }
        String messageId = MailDispatch.newMessageId(senderDomain());
        UUID record = messages.queued(accountId, kind, messageId);
        try {
            handover.attempt(messageId, () -> dispatch.send(address, subject, body, messageId));
        } catch (MailRecipientRefusedException refusal) {
            messages.refused(record, refusal.diagnosis(), refusal.statusCode());
            throw refusal;
        } catch (RuntimeException failure) {
            messages.failed(record, diagnosisOf(failure));
            throw failure;
        }
        messages.handedOver(record);
        log.info("Handed over a {} message for account {}", kind, accountId);
    }

    // Every escape, not a list of types: an exception this method does not know about would
    // otherwise leave the row on queued, which is the one thing this log exists to prevent.
    private static String diagnosisOf(RuntimeException failure) {
        return failure instanceof MailHandoverFailedException handover
                ? handover.diagnosis()
                : failure.getClass().getSimpleName();
    }

    private String senderDomain() {
        String from = properties.from();
        return from.substring(from.indexOf('@') + 1);
    }
}
