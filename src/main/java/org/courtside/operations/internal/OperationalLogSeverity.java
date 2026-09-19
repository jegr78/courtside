package org.courtside.operations.internal;

public enum OperationalLogSeverity {
    ERROR,
    WARN,
    INFO,
    DEBUG,
    UNKNOWN;

    static OperationalLogSeverity fromSyslogPriority(int priority) {
        return switch (priority & 7) {
            case 0, 1, 2, 3 -> ERROR;
            case 4 -> WARN;
            case 5, 6 -> INFO;
            case 7 -> DEBUG;
            default -> UNKNOWN;
        };
    }

    static OperationalLogSeverity fromText(String value, OperationalLogSeverity fallback) {
        if (value == null) {
            return fallback;
        }
        return switch (value.toUpperCase(java.util.Locale.ROOT)) {
            case "ERROR", "FATAL" -> ERROR;
            case "WARN", "WARNING" -> WARN;
            case "INFO", "NOTICE" -> INFO;
            case "DEBUG", "TRACE" -> DEBUG;
            default -> fallback;
        };
    }
}
