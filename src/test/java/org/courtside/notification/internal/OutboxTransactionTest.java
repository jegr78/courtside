package org.courtside.notification.internal;

import com.zaxxer.hikari.HikariDataSource;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.UsernameReminderRequested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;

@Import(IdentityTestFixture.class)
class OutboxTransactionTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private MessageRecordRepository records;

    @MockitoSpyBean
    private MessageChoices choices;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transactions;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private DataSource dataSource;

    @Test
    void givenAQueueInsertThatFails_whenTheChangeCommits_thenTheChangeIsRolledBackWithIt() {
        // given
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "doe.jane", Set.of(Role.MEMBER));
        doThrow(new IllegalStateException("the outbox refused the row")).when(records).save(any(MessageRecord.class));

        // when / then
        assertThatThrownBy(() -> transactions.executeWithoutResult(status -> {
            renameTo(personId, "Roe");
            events.publishEvent(new UsernameReminderRequested(accountId));
        })).isInstanceOf(IllegalStateException.class).hasMessage("the outbox refused the row");
        assertThat(lastName(personId))
                .as("a change whose message could not be stored must not commit without it")
                .isEqualTo("Doe");
        assertThat(rows(accountId)).isEmpty();
    }

    @Test
    void givenAChangeThatRollsBack_whenItsEventWasPublished_thenNoMessageIsQueued() {
        // given
        UUID personId = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "roe.john", Set.of(Role.MEMBER));

        // when
        transactions.executeWithoutResult(status -> {
            events.publishEvent(new UsernameReminderRequested(accountId));
            status.setRollbackOnly();
        });

        // then
        assertThat(rows(accountId)).as("a message about a change that never happened is never queued").isEmpty();
        assertThat(entries(accountId)).as("nor does the centre show an entry for it").isZero();
    }

    @Test
    void givenACentreEntryThatFails_whenTheChangeCommits_thenTheChangeIsRolledBackWithIt() {
        // given
        UUID personId = identity.createPerson("Jane", "Major", "jane.major@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "major.jane", Set.of(Role.MEMBER));
        jdbc.sql("ALTER TABLE notification ADD CONSTRAINT refuses_every_entry CHECK (false) NOT VALID").update();
        try {
            // when / then
            assertThatThrownBy(() -> transactions.executeWithoutResult(status -> {
                renameTo(personId, "Roe");
                events.publishEvent(new UsernameReminderRequested(accountId));
            })).isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("refuses_every_entry");
        } finally {
            jdbc.sql("ALTER TABLE notification DROP CONSTRAINT refuses_every_entry").update();
        }
        assertThat(lastName(personId))
                .as("a change whose centre entry could not be stored must not commit without it")
                .isEqualTo("Major");
        assertThat(rows(accountId)).as("nor does its message leave").isEmpty();
    }

    @Test
    void givenACommittingChange_whenItsMessageIsQueued_thenTheRowIsWrittenOnThePublishersOwnConnection() {
        // given
        UUID personId = identity.createPerson("Mary", "Major", "mary.major@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "major.mary", Set.of(Role.MEMBER));
        AtomicInteger activeAtInsert = new AtomicInteger(-1);
        doAnswer(invocation -> {
            activeAtInsert.set(pool().getHikariPoolMXBean().getActiveConnections());
            return invocation.callRealMethod();
        }).when(choices).wants(any(), any());

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(new UsernameReminderRequested(accountId)));

        // then
        assertThat(activeAtInsert.get())
                .as("queueing a message takes no connection beside the one the change commits on")
                .isEqualTo(1);
        assertThat(rows(accountId)).as("a committed change has its row").containsExactly("QUEUED");
        assertThat(entries(accountId)).as("and its centre entry").isEqualTo(1);
    }

    @Test
    void givenNoTransaction_whenAMailEventIsPublished_thenThePublisherIsToldInsteadOfTheMessageVanishing() {
        // given
        UUID personId = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        UUID accountId = identity.createEnabledAccount(personId, "miles.richard", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> events.publishEvent(new UsernameReminderRequested(accountId)))
                .as("a publisher outside a transaction would otherwise lose the message without a trace")
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(rows(accountId)).isEmpty();
    }

    private HikariDataSource pool() {
        try {
            return dataSource.unwrap(HikariDataSource.class);
        } catch (SQLException failure) {
            throw new IllegalStateException("The test data source is not a Hikari pool", failure);
        }
    }

    private void renameTo(UUID personId, String lastName) {
        jdbc.sql("UPDATE person SET last_name = :lastName WHERE id = :id")
                .param("lastName", lastName).param("id", personId).update();
    }

    private String lastName(UUID personId) {
        return jdbc.sql("SELECT last_name FROM person WHERE id = :id").param("id", personId)
                .query(String.class).single();
    }

    private int entries(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM notification WHERE account_id = :id").param("id", accountId)
                .query(Integer.class).single();
    }

    private List<String> rows(UUID accountId) {
        return jdbc.sql("SELECT state FROM message_record WHERE account_id = :id").param("id", accountId)
                .query(String.class).list();
    }
}
