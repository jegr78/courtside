package org.courtside.operations;

import org.courtside.operations.internal.OperationalLogCollector;

import java.util.Map;

public final class OperationalLogCollection {

    private OperationalLogCollection() {
    }

    public static boolean requested(String[] arguments) {
        return OperationalLogCollector.requested(arguments);
    }

    public static void run(Map<String, String> environment) {
        OperationalLogCollector.run(environment);
    }
}
