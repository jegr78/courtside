package org.courtside.booking.internal;

import java.util.UUID;

public interface CourtUtilisationRow {

    UUID getCourtId();

    int getCourtNumber();

    String getCourtName();

    long getBookingCount();

    long getOccupiedMinutes();
}
