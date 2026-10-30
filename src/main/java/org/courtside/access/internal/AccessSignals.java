package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.access.AccessGrantEvent;
import org.courtside.card.CardEvent;
import org.courtside.facility.FacilityEvent;
import org.courtside.shared.BookingCancelled;
import org.courtside.shared.BookingConfirmed;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.BookingReleased;
import org.courtside.shared.SeriesCancelled;
import org.courtside.shared.SeriesCreated;
import org.courtside.shared.SeriesMoved;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/** Wakes the access worker after a change that may alter what a booking asks of the doors; it writes nothing. */
@Component
@ConnectorSelected
@RequiredArgsConstructor
class AccessSignals {

    private final AccessWorker worker;

    @TransactionalEventListener
    void on(BookingConfirmed confirmed) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(BookingCancelled cancelled) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(BookingReleased released) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(BookingDisplaced displaced) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(SeriesCreated created) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(SeriesMoved moved) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(SeriesCancelled cancelled) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(CardEvent.BookingCardChanged changed) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(FacilityEvent.AccessPointAdded added) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(FacilityEvent.AccessPointChanged changed) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(FacilityEvent.AccessPointAvailabilityChanged switched) {
        worker.signal();
    }

    @TransactionalEventListener
    void on(AccessGrantEvent.RetryRequested requested) {
        worker.signal();
    }
}
