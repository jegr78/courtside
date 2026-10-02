package org.courtside.config.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.UUID;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class CoordinationPreparationTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private ClubConfigurationRepository configurations;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTheActualCoordinationQuery_whenStartupPreparesIt_thenTheBoundedTransactionRollsBackAndReleasesItsLock() {
        // given
        var completions = new ArrayList<Integer>();
        var modes = new ArrayList<String>();
        var actual = mockingDetails(configurations).getMockCreationSettings().getDefaultAnswer();
        clearInvocations(configurations);
        doAnswer(invocation -> {
            modes.add(jdbc.sql("SELECT current_setting('transaction_read_only')").query(String.class).single());
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    completions.add(status);
                }
            });
            return actual.answer(invocation);
        }).when(configurations).lockById(any(UUID.class));
        try (var context = preparationContext()) {
            context.refresh();
            verifyNoInteractions(configurations);

            // when
            publishReady(context);

            // then
            verify(configurations).lockById(ClubConfiguration.SINGLETON_ID);
            assertThat(modes).containsExactly("off");
            assertThat(completions).containsExactly(TransactionSynchronization.STATUS_ROLLED_BACK);
            new TransactionTemplate(transactions).executeWithoutResult(status ->
                    assertThat(jdbc.sql("SELECT id FROM club_config FOR NO KEY UPDATE NOWAIT")
                            .query(UUID.class).single()).isEqualTo(ClubConfiguration.SINGLETON_ID));
        }
    }

    @Test
    void givenAnUnexpectedWriteDuringPreparation_whenStartupCompletes_thenTheConfigurationChangeIsRolledBack() {
        // given
        int before = slotMinutes();
        var actual = mockingDetails(configurations).getMockCreationSettings().getDefaultAnswer();
        doAnswer(invocation -> {
            jdbc.sql("UPDATE club_config SET slot_minutes = 60").update();
            return actual.answer(invocation);
        }).when(configurations).lockById(any(UUID.class));
        try (var context = preparationContext()) {
            // when
            context.refresh();
            publishReady(context);

            // then
            assertThat(slotMinutes()).isEqualTo(before);
        }
    }

    @Test
    void givenAMissingConfiguration_whenStartupPreparesCoordination_thenReadinessFailsClosed() {
        // given
        jdbc.sql("DELETE FROM club_config").update();
        try (var context = preparationContext()) {
            // when / then
            context.refresh();
            assertThatThrownBy(() -> publishReady(context)).hasMessageContaining("The club configuration row is missing");
        }
    }

    @Test
    void givenAnAmbientReadOnlyTransaction_whenPreparingCoordination_thenItsOwnRollbackDoesNotMarkTheCaller() {
        // given
        var caller = new TransactionTemplate(transactions);
        caller.setReadOnly(true);
        try (var context = preparationContext()) {
            // when
            caller.executeWithoutResult(status -> {
                context.refresh();
                publishReady(context);

                // then
                assertThat(status.isRollbackOnly()).isFalse();
                assertThat(jdbc.sql("SELECT current_setting('transaction_read_only')")
                        .query(String.class).single()).isEqualTo("on");
            });
        }
    }

    private int slotMinutes() {
        return jdbc.sql("SELECT slot_minutes FROM club_config").query(Integer.class).single();
    }

    private static void publishReady(AnnotationConfigApplicationContext context) {
        context.publishEvent(new ApplicationReadyEvent(new SpringApplication(), new String[0], context, Duration.ZERO));
    }

    private AnnotationConfigApplicationContext preparationContext() {
        var context = new AnnotationConfigApplicationContext();
        context.registerBean(ClubConfigurationRepository.class, () -> configurations);
        context.registerBean(PlatformTransactionManager.class, () -> transactions);
        var definition = new RootBeanDefinition("org.courtside.config.internal.CoordinationPreparation");
        definition.setAutowireMode(AbstractBeanDefinition.AUTOWIRE_CONSTRUCTOR);
        context.registerBeanDefinition("coordinationPreparation", definition);
        return context;
    }
}
