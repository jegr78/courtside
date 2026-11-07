package org.courtside.shared;

import java.util.List;
import java.util.UUID;

/** Who may read the codes of the doors open to members: current members and outsiders holding a booking that opens them. */
public interface DoorCodeAudience {

    boolean includes(UUID accountId);

    // Every account whose own booking still opens the doors, members among them, so the caller pages by this list.
    List<UUID> bookersAfter(UUID after, int limit);
}
