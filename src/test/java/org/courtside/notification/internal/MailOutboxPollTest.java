package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Clock;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class MailOutboxPollTest {

    @Test
    @SuppressWarnings("unchecked")
    void whenTheScheduledPollFires_thenAPassIsHandedToTheOutboxWorkers() {
        // given
        TaskExecutor workers = mock(TaskExecutor.class);
        MailOutbox outbox = new MailOutbox(workers, mock(PlatformTransactionManager.class), mock(JdbcClient.class),
                mock(MessageRecordRepository.class), mock(ObjectProvider.class), mock(MailDispatch.class),
                new MailHandover(), mock(MessageLog.class), Clock.systemUTC());

        // when
        outbox.poll();

        // then
        verify(workers).execute(any(Runnable.class));
    }
}
