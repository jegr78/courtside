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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Slf4j
@Component
class MailOutbox {

    // Six attempts spread over about half an hour outlast a relay restart, upgrade or host reboot.
    static final int ATTEMPTS = 6;
    private static final Duration FIRST_GAP = Duration.ofSeconds(15);
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
        Optional<Claimed> claimed = Optional.empty();
        try {
            claimed = claimNext();
            while (claimed.isPresent()) {
                deliver(claimed.get());
                claimed = claimNext();
            }
        } catch (RuntimeException failure) {
            log.warn("Delivering queued messages stopped at {} until the next pass: {}",
                    claimed.map(Claimed::messageId).orElse("a claim"), chainOf(failure));
        }
    }

    // A row another pass holds is skipped rather than waited for, and the lease it commits keeps
    // every later pass off it until a pass that died with it has certainly stopped.
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
                        row.getObject("account_id", UUID.class), row.getString("kind"),
                        parameters(row.getString("parameters")), row.getString("message_id"),
                        row.getInt("attempts")))
                .optional());
    }

    private void deliver(Claimed claimed) {
        Optional<MessageKind> kind = Arrays.stream(MessageKind.values())
                .filter(known -> known.name().equals(claimed.kind()))
                .findFirst();
        if (kind.isEmpty()) {
            settle(claimed, record -> messages.failed(record, "UnknownKind"));
            return;
        }
        if (claimed.attempts() > ATTEMPTS) {
            settle(claimed, record -> messages.failed(record, "AttemptsExhausted"));
            return;
        }
        QueuedMessage message = new QueuedMessage(claimed.accountId(), kind.get(), claimed.parameters());
        try {
            transactions.executeWithoutResult(status -> handOverAndSettle(claimed, message));
        } catch (MessageUndeliverableException undeliverable) {
            log.info("A {} message for account {} cannot be written: {}", message.kind(), message.accountId(),
                    undeliverable.reason());
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

    // One transaction holds the row, whatever composing stores and the outcome, so a credential the
    // relay accepted is never stored without its row saying so.
    private void handOverAndSettle(Claimed claimed, QueuedMessage message) {
        Optional<MessageRecord> held = heldBy(claimed);
        if (held.isEmpty()) {
            return;
        }
        AtomicBoolean handedOver = new AtomicBoolean();
        composerFor(message.kind()).compose(message, mail -> {
            handover.attempt(claimed.messageId(), () -> send(mail, claimed.messageId()));
            handedOver.set(true);
        });
        if (handedOver.get()) {
            messages.handedOver(held.get());
            log.info("Handed over a {} message for account {}", message.kind(), message.accountId());
        } else {
            messages.failed(held.get(), "NothingComposed");
        }
    }

    private void settle(Claimed claimed, Consumer<MessageRecord> outcome) {
        transactions.executeWithoutResult(status -> heldBy(claimed).ifPresent(outcome));
    }

    // A pass whose lease ran out may find its row taken over, and then it neither sends nor writes.
    private Optional<MessageRecord> heldBy(Claimed claimed) {
        Optional<MessageRecord> held = records.lockById(claimed.id())
                .filter(record -> record.getAttempts() == claimed.attempts());
        if (held.isEmpty()) {
            log.warn("Message {} was taken over by another pass", claimed.messageId());
        }
        return held;
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

    // Types only: a mail library's message can carry the address it was given.
    private static String chainOf(Throwable failure) {
        List<String> types = new ArrayList<>();
        for (Throwable cause = failure; cause != null && types.size() < 10; cause = cause.getCause()) {
            types.add(cause.getClass().getName());
        }
        return types.stream().collect(Collectors.joining(" <- "));
    }

    private record Claimed(UUID id, UUID accountId, String kind, Map<String, String> parameters,
                           String messageId, int attempts) {
    }
}
