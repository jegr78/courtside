package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.ArrayList;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class BookingLookupPreparationTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private BookingRepository bookings;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTheActualRepository_whenStartupPreparesTheLookup_thenOneReadOnlyQueryLeavesBookingsUnchanged() {
        // given
        long before = bookings.count();
        clearInvocations(bookings);
        var readOnlyModes = new ArrayList<String>();
        var query = mockingDetails(bookings).getMockCreationSettings().getDefaultAnswer();
        doAnswer(invocation -> {
            readOnlyModes.add(jdbc.sql("SELECT current_setting('transaction_read_only')").query(String.class).single());
            return query.answer(invocation);
        }).when(bookings).findByBookedByAndIdempotencyKey(any(UUID.class), anyString());
        try (var context = preparationContext()) {
            // when
            context.refresh();

            // then
            verify(bookings, times(1)).findByBookedByAndIdempotencyKey(any(UUID.class), anyString());
            assertThat(readOnlyModes).containsExactly("on");
            assertThat(bookings.count()).isEqualTo(before);
        }
    }

    @Test
    void givenAnActualDatabaseFailure_whenPreparingTheLookup_thenStartupFailsWithoutChangingBookings() {
        // given
        long before = bookings.count();
        doAnswer(invocation -> jdbc.sql("SELECT 1 / 0").query(Integer.class).single())
                .when(bookings).findByBookedByAndIdempotencyKey(any(UUID.class), anyString());
        try (var context = preparationContext()) {
            // when / then
            assertThatThrownBy(context::refresh).rootCause().hasMessageContaining("division by zero");
            assertThat(context.isActive()).isFalse();
            assertThat(bookings.count()).isEqualTo(before);
        }
    }

    private GenericApplicationContext preparationContext() {
        var context = new GenericApplicationContext();
        context.registerBean(BookingRepository.class, () -> bookings);
        context.registerBean(PlatformTransactionManager.class, () -> transactions);
        var definition = new RootBeanDefinition("org.courtside.booking.internal.BookingLookupPreparation");
        definition.setAutowireMode(AbstractBeanDefinition.AUTOWIRE_CONSTRUCTOR);
        context.registerBeanDefinition("bookingLookupPreparation", definition);
        return context;
    }
}
