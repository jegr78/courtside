package org.courtside.notification.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.notification.MessageKind;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Stream;

@Slf4j
@Component
class MailOutbox {

    // The relay is a neighbour in the same network: one that cannot be reached is restarting, and
    // that is over in minutes, while waiting days would leave an account nobody can act on.
    static final int ATTEMPTS = 4;
    private static final Duration FIRST_GAP = Duration.ofSeconds(5);
    private static final int GROWTH = 3;

    // Far longer than one handover can take under the relay timeouts, so only a pass that died
    // mid-delivery lets another one take its row.
    static final Duration LEASE = Duration.ofMinutes(5);

    // Somebody waits at a sign-in page for these, so a busy evening of bookings goes after them.
    private static final List<String> URGENT = Stream.of(MessageKind.CREDENTIALS_NEW_ACCOUNT,
                    MessageKind.CREDENTIALS_PASSWORD_RESET, MessageKind.ACCOUNT_USERNAME_REMINDER,
                    MessageKind.ACCOUNT_PASSWORD_RESET_CODE)
            .map(Enum::name)
            .toList();

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final TypeReference<Map<String, String>> PARAMETERS = new TypeReference<>() {
    };

    private final TaskExecutor executor;
    private final TransactionTemplate transactions;
    private final JdbcClient jdbc;
    private final MessageRecordRepository records;
    private final ObjectProvider<MessageComposer> composers;
    private final MailDispatch dispatch;
    private final MailHandover handover;
    private final MessageLog messages;
    private final Clock clock;

    MailOutbox(@Qualifier("mailOutboxExecutor") TaskExecutor executor,
               PlatformTransactionManager transactionManager, JdbcClient jdbc, MessageRecordRepository records,
               ObjectProvider<MessageComposer> composers, MailDispatch dispatch, MailHandover handover,
               MessageLog messages, Clock clock) {
        this.executor = executor;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.jdbc = jdbc;
        this.records = records;
        this.composers = composers;
        this.dispatch = dispatch;
        this.handover = handover;
        this.messages = messages;
        this.clock = clock;
    }

    // Never on the caller: a full queue already holds a pass that will see the new row.
    void wake() {
        executor.execute(this::deliverDue);
    }

    // What a restart left queued, and every retry that has come due, is found here.
    @Scheduled(initialDelay = 5, fixedDelay = 5, timeUnit = TimeUnit.SECONDS)
    void poll() {
        wake();
    }

    void deliverDue() {
        try {
            Optional<Claimed> claimed = claimNext();
            while (claimed.isPresent()) {
                deliver(claimed.get());
                claimed = claimNext();
            }
        } catch (RuntimeException failure) {
            log.warn("Delivering queued messages stopped until the next pass: {}",
                    failure.getClass().getSimpleName());
        }
    }

    // A row another pass holds is skipped rather than waited for, and the lease it commits keeps
    // every later pass off it, so no message is handed over twice.
    private Optional<Claimed> claimNext() {
        Instant now = clock.instant();
        return transactions.execute(status -> jdbc.sql("""
                        UPDATE message_record SET attempts = attempts + 1, next_attempt_at = :leaseEnd
                        WHERE id = (
                            SELECT id FROM message_record
                            WHERE state = 'QUEUED' AND next_attempt_at <= :now
                            ORDER BY CASE WHEN kind IN (:urgent) THEN 0 ELSE 1 END, queued_seq
                            LIMIT 1
                            FOR UPDATE SKIP LOCKED)
                        RETURNING id, account_id, kind, message_id, parameters::text AS parameters, attempts
                        """)
                .param("now", Timestamp.from(now))
                .param("leaseEnd", Timestamp.from(now.plus(LEASE)))
                .param("urgent", URGENT)
                .query((row, number) -> new Claimed(row.getObject("id", UUID.class),
                        new QueuedMessage(row.getObject("account_id", UUID.class),
                                MessageKind.valueOf(row.getString("kind")),
                                parameters(row.getString("parameters"))),
                        row.getString("message_id"), row.getInt("attempts")))
                .optional());
    }

    private void deliver(Claimed claimed) {
        try {
            if (!handOver(claimed)) {
                settle(claimed, record -> messages.failed(record, "NothingComposed"));
                return;
            }
            settle(claimed, messages::handedOver);
            log.info("Handed over a {} message for account {}", claimed.message().kind(),
                    claimed.message().accountId());
        } catch (MessageUndeliverableException undeliverable) {
            log.info("A {} message for account {} cannot be written: {}", claimed.message().kind(),
                    claimed.message().accountId(), undeliverable.reason());
            settle(claimed, record -> messages.failed(record, undeliverable.reason()));
        } catch (MailRecipientRefusedException refusal) {
            settle(claimed, record -> messages.refused(record, refusal.diagnosis(), refusal.statusCode()));
        } catch (RuntimeException failure) {
            String diagnosis = diagnosisOf(failure);
            if (claimed.attempts() >= ATTEMPTS) {
                log.warn("Gave up handing over {} after {} attempts: {}", claimed.messageId(),
                        claimed.attempts(), diagnosis);
                settle(claimed, record -> messages.failed(record, diagnosis));
            } else {
                Instant next = clock.instant().plus(gapAfter(claimed.attempts()));
                settle(claimed, record -> messages.retry(record, diagnosis, next));
            }
        }
    }

    private boolean handOver(Claimed claimed) {
        MessageComposer composer = composerFor(claimed.message().kind());
        AtomicBoolean handedOver = new AtomicBoolean();
        transactions.executeWithoutResult(status -> composer.compose(claimed.message(), mail -> {
            handover.attempt(claimed.messageId(), () -> send(mail, claimed.messageId()));
            handedOver.set(true);
        }));
        return handedOver.get();
    }

    // Only the pass that holds this attempt writes its outcome: one whose lease ran out has been
    // overtaken, and the pass that took the row over writes the outcome instead.
    private void settle(Claimed claimed, Consumer<MessageRecord> outcome) {
        transactions.executeWithoutResult(status -> records.lockById(claimed.id())
                .filter(record -> record.getAttempts() == claimed.attempts())
                .ifPresentOrElse(outcome, () -> log.warn("Message {} was taken over before its outcome"
                        + " was written", claimed.messageId())));
    }

    private void send(OutgoingMail mail, String messageId) {
        mail.attachment().ifPresentOrElse(
                file -> dispatch.send(mail.address(), mail.subject(), mail.body(), messageId, file),
                () -> dispatch.send(mail.address(), mail.subject(), mail.body(), messageId));
    }

    private MessageComposer composerFor(MessageKind kind) {
        return composers.orderedStream()
                .filter(composer -> composer.kinds().contains(kind))
                .findFirst()
                .orElseThrow(() -> new MessageUndeliverableException("NoComposer"));
    }

    // Unreadable parameters compose as missing ones, which settles the row instead of claiming it forever.
    private static Map<String, String> parameters(String stored) {
        try {
            return JSON.readValue(stored, PARAMETERS);
        } catch (JacksonException unreadable) {
            return Map.of();
        }
    }

    private static Duration gapAfter(int attempts) {
        Duration gap = FIRST_GAP;
        for (int attempt = 1; attempt < attempts; attempt++) {
            gap = gap.multipliedBy(GROWTH);
        }
        return gap;
    }

    // Every escape, not a list of types: an exception this class does not know about would
    // otherwise leave the row on queued without a word about why.
    private static String diagnosisOf(RuntimeException failure) {
        return failure instanceof MailHandoverFailedException handover
                ? handover.diagnosis()
                : failure.getClass().getSimpleName();
    }

    private record Claimed(UUID id, QueuedMessage message, String messageId, int attempts) {
    }
}
