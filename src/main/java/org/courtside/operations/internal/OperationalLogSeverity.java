package org.courtside.operations.internal;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public enum OperationalLogSeverity {
    ERROR,
    WARN,
    INFO,
    DEBUG,
    UNKNOWN;

    // PostgreSQL's default log_line_prefix '%m [%p] ' followed by the level it chose.
    private static final Pattern POSTGRESQL_LEVEL =
            Pattern.compile("^\\d{4}-\\d{2}-\\d{2} [\\d:.]+ \\S+ \\[\\d+] ([A-Z]+[1-5]?):\\s");

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

    static OperationalLogSeverity fromPostgresqlLine(String line, OperationalLogSeverity fallback) {
        Matcher level = POSTGRESQL_LEVEL.matcher(line);
        if (!level.find()) {
            return fallback;
        }
        return switch (level.group(1)) {
            case "ERROR", "FATAL", "PANIC" -> ERROR;
            case "WARNING" -> WARN;
            case "LOG", "INFO", "NOTICE" -> INFO;
            case "DEBUG1", "DEBUG2", "DEBUG3", "DEBUG4", "DEBUG5" -> DEBUG;
            default -> fallback;
        };
    }
}
