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

import java.util.List;
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
        messages.handedOver(queued("handed-over-message"));
        messages.refused(queued("refused-message"), "SendFailedException", "550");
        messages.failed(queued("failed-message"), "MailConnectException");

        // then
        assertThat(counter(MessageState.HANDED_OVER)).isEqualTo(handedOverBefore + 1);
        assertThat(counter(MessageState.REFUSED)).isEqualTo(refusedBefore + 1);
        assertThat(counter(MessageState.FAILED)).isEqualTo(failedBefore + 1);
    }

    @Test
    void whenTheCounterIsRead_thenItCarriesNothingThatNamesWhoWasWrittenTo() {
        // given
        messages.handedOver(queued("a-message-id"));

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
    void givenARecordThatIsGone_whenSettlingIt_thenNothingIsCountedForARowNobodyHas() {
        // given — an account deleted between queueing and handing over takes its row with it
        UUID recordId = queued("a-message-id");
        double before = counter(MessageState.HANDED_OVER);
        records.deleteById(recordId);

        // when
        messages.handedOver(recordId);

        // then — a counter that outran the table would report a state change nothing records
        assertThat(counter(MessageState.HANDED_OVER)).isEqualTo(before);
    }

    @Test
    void whenAStateTheApplicationDoesNotKnowIsWritten_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then — no state may claim delivery, and the schema is where that is enforced
        assertThatThrownBy(() -> jdbc.sql("""
                UPDATE message_record SET state = 'DELIVERED', settled_at = now() WHERE id = :id
                """).param("id", recordId).update())
                .hasMessageContaining("message_record_state_known");
    }

    @Test
    void whenAMessageIsSettledWithoutSayingWhen_thenTheDatabaseRefusesIt() {
        // given
        UUID recordId = queued("a-message-id");

        // when / then — a settled row with no instant reads as still on its way
        assertThatThrownBy(() -> jdbc.sql("UPDATE message_record SET state = 'FAILED' WHERE id = :id")
                .param("id", recordId).update())
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
        return messages.queued(accountId, MessageKind.CREDENTIALS_NEW_ACCOUNT, messageId);
    }

    private double counter(MessageState state) {
        var counter = meters.find("courtside.messages")
                .tag("state", state.name().toLowerCase(Locale.ROOT))
                .counter();
        return counter == null ? 0 : counter.count();
    }
}
