package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class RecordedHandover {

    private final MailDispatch dispatch;
    private final MailHandover handover;
    private final MailProperties properties;
    private final MessageLog messages;

    void handOver(UUID accountId, MessageKind kind, String address, String subject, String body) {
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
