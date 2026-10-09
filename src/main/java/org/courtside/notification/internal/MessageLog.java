package org.courtside.notification.internal;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.courtside.notification.MessageState;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.function.Consumer;

// Writes an outcome onto a row the caller has locked and checked against its own attempt.
@Service
@RequiredArgsConstructor
class MessageLog {

    private final MessageRecordRepository records;
    private final MeterRegistry meters;
    private final Clock clock;

    @Transactional(propagation = Propagation.MANDATORY)
    public void handedOver(MessageRecord record) {
        settle(record, claimed -> claimed.handedOver(clock.instant()), MessageState.HANDED_OVER);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refused(MessageRecord record, String reason, String statusCode) {
        settle(record, claimed -> claimed.refused(clock.instant(), reason, statusCode), MessageState.REFUSED);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void failed(MessageRecord record, String reason) {
        settle(record, claimed -> claimed.failed(clock.instant(), reason), MessageState.FAILED);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void retry(MessageRecord record, String reason, Instant at) {
        record.retryAt(at, reason);
        records.save(record);
        meters.counter("courtside.messages.retried").increment();
    }

    // The state and nothing else: a counter an operator watches must not become a list of who was
    // written to, which is what any account, person or address dimension would make it.
    private void settle(MessageRecord record, Consumer<MessageRecord> settlement, MessageState settled) {
        settlement.accept(record);
        records.save(record);
        meters.counter("courtside.messages", "state", settled.name().toLowerCase(Locale.ROOT)).increment();
    }
}
