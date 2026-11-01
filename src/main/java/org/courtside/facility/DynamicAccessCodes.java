package org.courtside.facility;

/** The codes drawn for bookings that a door may still accept, owned by whoever draws them. */
public interface DynamicAccessCodes {

    boolean holds(String code);
}
