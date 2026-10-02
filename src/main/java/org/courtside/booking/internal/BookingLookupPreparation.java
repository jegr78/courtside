package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class BookingLookupPreparation implements SmartInitializingSingleton {

    private final BookingRepository bookings;
    private final PlatformTransactionManager transactions;

    @Override
    public void afterSingletonsInstantiated() {
        var transaction = new TransactionTemplate(transactions);
        transaction.setReadOnly(true);
        transaction.executeWithoutResult(status -> {
            var account = new UUID(0, 0);
            bookings.findByBookedByAndIdempotencyKey(account, "startup-preparation");
            bookings.countOpenBookings(account, Instant.EPOCH);
        });
    }
}
