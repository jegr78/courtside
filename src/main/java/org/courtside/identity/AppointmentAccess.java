package org.courtside.identity;

import java.util.Set;

public interface AppointmentAccess {

    record Reach(boolean managesAppointments, boolean createsSeries) {
    }

    Reach reachOf(Set<Role> roles);
}
