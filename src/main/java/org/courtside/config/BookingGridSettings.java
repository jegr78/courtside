package org.courtside.config;

public interface BookingGridSettings {

    BookingSlotDuration slotDuration();

    default int slotMinutes() {
        return slotDuration().minutes();
    }
}
