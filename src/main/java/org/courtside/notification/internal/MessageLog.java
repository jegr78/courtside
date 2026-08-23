package org.courtside.notification.internal;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Consumer;

// Each state change stands on its own transaction, because the one the handover runs in is rolled
// back by a failure — the outcome this log exists to explain would be the one it never recorded.
@Service
@RequiredArgsConstructor
class MessageLog {

    private final MessageRecordRepository records;
    private final MeterRegistry meters;
    private final Clock clock;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public UUID queued(UUID accountId, MessageKind kind, String messageId) {
        return records.save(new MessageRecord(accountId, kind, messageId, clock.instant())).getId();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void handedOver(UUID recordId) {
        settle(recordId, record -> record.handedOver(clock.instant()), MessageState.HANDED_OVER);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void refused(UUID recordId, String reason, String statusCode) {
        settle(recordId, record -> record.refused(clock.instant(), reason, statusCode),
                MessageState.REFUSED);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void failed(UUID recordId, String reason) {
        settle(recordId, record -> record.failed(clock.instant(), reason), MessageState.FAILED);
    }

    // The state and nothing else: a counter an operator watches must not become a list of who was
    // written to, which is what any account, person or address dimension would make it.
    private void settle(UUID recordId, Consumer<MessageRecord> settlement, MessageState settled) {
        records.findById(recordId).ifPresent(record -> {
            settlement.accept(record);
            records.save(record);
        });
        meters.counter("courtside.messages", "state", settled.name().toLowerCase(Locale.ROOT))
                .increment();
    }
}
