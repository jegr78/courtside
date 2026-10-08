package org.courtside.notification.internal;

import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tag;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class MessageLogTest extends AbstractIntegrationTest {

    @Autowired
    private MessageLog messages;

    @Autowired
    private MessageRecordRepository records;

    @Autowired
    private MeterRegistry meters;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private TransactionTemplate transactions;

    private UUID accountId;

    @BeforeEach
    void createAnAccountToWriteTo() {
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        accountId = identity.createEnabledAccount(personId, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void whenAMessageReachesEachSettledState_thenEachIsCountedUnderItsOwnState() {
        // given
        double handedOverBefore = counter(MessageState.HANDED_OVER);
        double refusedBefore = counter(MessageState.REFUSED);
        double failedBefore = counter(MessageState.FAILED);

        // when
        settle(queued("handed-over-message"), messages::handedOver);
        settle(queued("refused-message"), record -> messages.refused(record, "SendFailedException", "550"));
        settle(queued("failed-message"), record -> messages.failed(record, "MailConnectException"));

        // then
        assertThat(counter(MessageState.HANDED_OVER)).isEqualTo(handedOverBefore + 1);
        assertThat(counter(MessageState.REFUSED)).isEqualTo(refusedBefore + 1);
        assertThat(counter(MessageState.FAILED)).isEqualTo(failedBefore + 1);
    }

    @Test
    void whenTheCounterIsRead_thenItCarriesNothingThatNamesWhoWasWrittenTo() {
        // given
        settle(queued("a-message-id"), messages::handedOver);

        // when
        List<String> tagKeys = meters.find("courtside.messages").meters().stream()
                .map(Meter::getId)
                .flatMap(id -> id.getTags().stream())
                .map(Tag::getKey)
                .distinct()
                .toList();

        // then — a counter an operator watches must not become a list of who holds an account
        assertThat(tagKeys).containsExactly("state");
    }

    @Test
    void givenAFailedAttempt_whenItIsRescheduled_thenTheRowStaysQueuedWithItsReasonAndTheRetryIsCounted() {
        // given
        UUID recordId = queued("a-message-id");
        double retriedBefore = retried();
        Instant later = Instant.parse("2026-05-12T10:00:05Z");

        // when
        settle(recordId, record -> messages.retry(record, "MailConnectException", later));

        // then
        MessageRecord record = records.findById(recordId).orElseThrow();
        assertThat(record.getState()).as("a retry is still on its way").isEqualTo(MessageState.QUEUED);
        assertThat(record.getNextAttemptAt()).isEqualTo(later);
        assertThat(record.getReason()).as("what went wrong is readable before the retry").isEqualTo("MailConnectException");
        assertThat(retried()).isEqualTo(retriedBefore + 1);
    }

    @Test
    void givenAQueuedRowWithItsParameters_whenItIsSettled_thenNothingItNeededForDeliveryIsKept() {
        // given
        UUID recordId = queued("a-message-id");

        // when
        settle(recordId, messages::handedOver);

        // then
        Map<String, Object> row = jdbc.sql("""
                SELECT parameters::text AS parameters, next_attempt_at FROM message_record WHERE id = :id
                """).param("id", recordId).query().singleRow();
        assertThat(row.get("parameters")).as("a booking id outlives no delivery").isEqualTo("{}");
        assertThat(row.get("next_attempt_at")).as("a settled message is due for nothing").isNull();
    }

    @Test
    void whenASettledRowKeepsItsDeliveryParameters_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE message_record SET state = 'HANDED_OVER', settled_at = now(), next_attempt_at = NULL
                WHERE id = :id
                """).param("id", recordId).update())
                .hasMessageContaining("message_record_parameters_while_queued");
    }

    @Test
    void whenAQueuedRowIsDueAtNoTime_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then — a queued row no pass would ever pick up is a message dropped in silence
        assertThatThrownBy(() -> jdbc.sql("UPDATE message_record SET next_attempt_at = NULL WHERE id = :id")
                .param("id", recordId).update())
                .hasMessageContaining("message_record_due_while_queued");
    }

    @Test
    void whenAttemptsAreCountedBelowZero_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then
        assertThatThrownBy(() -> jdbc.sql("UPDATE message_record SET attempts = -1 WHERE id = :id")
                .param("id", recordId).update())
                .hasMessageContaining("message_record_attempts_counted");
    }

    @Test
    void whenAStateTheApplicationDoesNotKnowIsWritten_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then — no state may claim delivery, and the schema is where that is enforced
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE message_record SET state = 'DELIVERED', settled_at = now(), next_attempt_at = NULL,
                       parameters = '{}' WHERE id = :id
                """).param("id", recordId).update())
                .hasMessageContaining("message_record_state_known");
    }

    @Test
    void whenAMessageIsSettledWithoutSayingWhen_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then — a settled row with no instant reads as still on its way
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE message_record SET state = 'FAILED', next_attempt_at = NULL, parameters = '{}'
                WHERE id = :id
                """).param("id", recordId).update())
                .hasMessageContaining("message_record_settled_with_its_state");
    }

    @Test
    void givenAMessageWasRecorded_whenTheAccountIsDeleted_thenTheRecordGoesWithIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when — the record explains a message to a person, and outliving them explains nothing
        jdbc.sql("DELETE FROM user_account WHERE id = :id").param("id", accountId).update();

        // then
        assertThat(records.findById(recordId)).isEmpty();
    }

    private UUID queued(String messageId) {
        return records.save(new MessageRecord(accountId, MessageKind.BOOKING_CONFIRMED, messageId,
                Instant.parse("2026-05-12T10:00:00Z"), Map.of(QueuedMessage.BOOKING, UUID.randomUUID().toString())))
                .getId();
    }

    private void settle(UUID recordId, java.util.function.Consumer<MessageRecord> settlement) {
        transactions.executeWithoutResult(status ->
                settlement.accept(records.findById(recordId).orElseThrow()));
    }

    private double retried() {
        var counter = meters.find("courtside.messages.retried").counter();
        return counter == null ? 0 : counter.count();
    }

    private double counter(MessageState state) {
        var counter = meters.find("courtside.messages")
                .tag("state", state.name().toLowerCase(Locale.ROOT))
                .counter();
        return counter == null ? 0 : counter.count();
    }
}
