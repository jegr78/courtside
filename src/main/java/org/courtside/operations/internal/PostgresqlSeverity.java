package org.courtside.operations.internal;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class PostgresqlSeverity {

    // PostgreSQL's default log_line_prefix '%m [%p] ' followed by the level it chose.
    private static final Pattern PREFIXED =
            Pattern.compile("^\\d{4}-\\d{2}-\\d{2} [\\d:.]+ \\S+ \\[(\\d+)] ([A-Z]+[1-5]?):\\s");
    private static final int REMEMBERED_PROCESSES = 256;

    private final Map<String, OperationalLogSeverity> lastByProcess = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, OperationalLogSeverity> eldest) {
            return size() > REMEMBERED_PROCESSES;
        }
    };
    private OperationalLogSeverity lastWritten;

    synchronized OperationalLogSeverity of(String line, OperationalLogSeverity envelope) {
        Matcher prefixed = PREFIXED.matcher(line);
        if (prefixed.find()) {
            String process = prefixed.group(1);
            Optional<OperationalLogSeverity> own = level(prefixed.group(2));
            if (own.isEmpty()) {
                return lastByProcess.getOrDefault(process, envelope);
            }
            lastByProcess.put(process, own.get());
            lastWritten = own.get();
            return own.get();
        }
        boolean continuesTheLastMessage = !line.isEmpty() && Character.isWhitespace(line.charAt(0));
        return continuesTheLastMessage && lastWritten != null ? lastWritten : envelope;
    }

    private static Optional<OperationalLogSeverity> level(String level) {
        return switch (level) {
            case "ERROR", "FATAL", "PANIC" -> Optional.of(OperationalLogSeverity.ERROR);
            case "WARNING" -> Optional.of(OperationalLogSeverity.WARN);
            case "LOG", "INFO", "NOTICE" -> Optional.of(OperationalLogSeverity.INFO);
            case "DEBUG1", "DEBUG2", "DEBUG3", "DEBUG4", "DEBUG5" -> Optional.of(OperationalLogSeverity.DEBUG);
            default -> Optional.empty();
        };
    }
}
