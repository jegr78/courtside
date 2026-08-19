package org.courtside;

import org.courtside.member.RosterEvent;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.modulith.events.IncompleteEventPublications;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

@Import({MemberTestFixture.class, DomainEventDeliveryTest.RefusingConsumer.class})
class DomainEventDeliveryTest extends AbstractIntegrationTest {

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private RefusingConsumer consumer;

    @Autowired
    private IncompleteEventPublications incomplete;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAConsumerThatFails_whenTheEventIsResubmitted_thenItIsDeliveredRatherThanLost()
            throws InterruptedException {
        // given
        roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        assertThat(consumer.awaitRefusal()).isTrue();
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(undeliveredPublications()).isOne());

        // when
        incomplete.resubmitIncompletePublications(publication -> true);

        // then
        assertThat(consumer.awaitAcceptance()).isTrue();
        assertThat(consumer.attempts()).isEqualTo(2);
        // The registry marks a delivery complete after the consumer returns, not before.
        await().atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(undeliveredPublications()).isZero());
    }

    private long undeliveredPublications() {
        return jdbc.sql("SELECT count(*) FROM event_publication WHERE completion_date IS NULL")
                .query(Long.class).single();
    }

    static class RefusingConsumer {

        private final CountDownLatch refused = new CountDownLatch(1);
        private final CountDownLatch accepted = new CountDownLatch(1);
        private final AtomicInteger attempts = new AtomicInteger();

        boolean awaitRefusal() throws InterruptedException {
            return refused.await(10, TimeUnit.SECONDS);
        }

        boolean awaitAcceptance() throws InterruptedException {
            return accepted.await(10, TimeUnit.SECONDS);
        }

        int attempts() {
            return attempts.get();
        }

        @ApplicationModuleListener
        void on(RosterEvent.PersonAdded event) {
            if (attempts.incrementAndGet() == 1) {
                refused.countDown();
                throw new IllegalStateException("This consumer refuses its first delivery");
            }
            accepted.countDown();
        }
    }
}
