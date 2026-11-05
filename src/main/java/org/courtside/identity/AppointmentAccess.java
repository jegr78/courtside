package org.courtside.identity;

import java.util.Set;
import java.util.UUID;

public interface AppointmentAccess {

    record Reach(boolean managesAppointments, boolean createsSeries) {
    }

    Reach reachOf(UUID accountId, Set<Role> roles);
}
