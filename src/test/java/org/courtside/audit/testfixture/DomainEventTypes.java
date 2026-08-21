package org.courtside.audit.testfixture;

import org.courtside.shared.DomainEventRecord;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.List;

public final class DomainEventTypes {

    private DomainEventTypes() {
    }

    public static List<String> typesOf(Class<? extends DomainEventRecord> eventFamily) {
        Class<?>[] permitted = eventFamily.getPermittedSubclasses();
        if (permitted == null) {
            throw new IllegalStateException(eventFamily.getName() + " must be sealed to name its event types");
        }
        return Arrays.stream(permitted).map(DomainEventTypes::typeOf).toList();
    }

    // Read, never instantiated: a record of this project validates in its compact constructor.
    public static String typeOf(Class<?> eventRecord) {
        try {
            Field declared = eventRecord.getDeclaredField("TYPE");
            declared.setAccessible(true);
            return (String) declared.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(
                    eventRecord.getName() + " must declare its event type as a TYPE constant", e);
        }
    }
}
