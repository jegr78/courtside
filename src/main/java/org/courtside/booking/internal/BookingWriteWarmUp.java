package org.courtside.booking.internal;

import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.identity.Role;
import org.courtside.shared.WarmUpStep;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Component
@Order(40)
class BookingWriteWarmUp implements WarmUpStep {

    private static final int DAYS_AHEAD = 400;
    private static final int TRANSACTION_TIMEOUT_SECONDS = 10;
    private static final Set<Role> ADMINISTRATOR = Set.of(Role.ADMIN);

    private final WarmUpTarget targets;
    private final BookingService bookings;
    private final TransactionTemplate transaction;

    BookingWriteWarmUp(WarmUpTarget targets, BookingService bookings, PlatformTransactionManager transactions) {
        this.targets = targets;
        this.bookings = bookings;
        this.transaction = new TransactionTemplate(transactions);
        this.transaction.setTimeout(TRANSACTION_TIMEOUT_SECONDS);
    }

    @Override
    public String name() {
        return "booking-write";
    }

    // Rolled back, so no before-commit listener stores an audit event or a message.
    @Override
    public boolean run() {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            status.setRollbackOnly();
            Optional<WarmUpTarget.Target> target = targets.find(DAYS_AHEAD);
            if (target.isEmpty()) {
                return false;
            }
            UUID booking = bookings.create(new CreateBookingCommand(List.of(target.get().courtId()),
                    target.get().cardId(), target.get().slot(), WarmUpTarget.BOOKER, null, ADMINISTRATOR,
                    null, List.of(), null));
            bookings.cancel(booking, WarmUpTarget.BOOKER, ADMINISTRATOR);
            return true;
        }));
    }
}
