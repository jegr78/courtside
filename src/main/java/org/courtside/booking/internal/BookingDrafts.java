package org.courtside.booking.internal;

import org.courtside.booking.CreateBookingCommand;

import java.util.UUID;

public interface BookingDrafts {

    // Every check a booking passes except that its courts are free.
    void requireBookable(CreateBookingCommand command);

    // The same checks as a verdict, leaving the caller's transaction intact when one refuses.
    boolean isBookable(CreateBookingCommand command);

    UUID write(CreateBookingCommand command);
}
