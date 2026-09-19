package org.courtside.operations.internal;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class OperationalLogParser {

    static final int MAX_DATAGRAM_BYTES = 16_384;
    private static final int MAX_MESSAGE_CHARACTERS = 8_192;
    private static final Pattern PRIORITY_AND_VERSION = Pattern.compile("^<(\\d{1,3})>1$");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final Clock clock;

    OperationalLogParser() {
        this(Clock.systemUTC());
    }

    OperationalLogParser(Clock clock) {
        this.clock = clock;
    }

    Optional<OperationalLogRecord> parse(byte[] datagram, int length) {
        if (length <= 0 || length > MAX_DATAGRAM_BYTES || length > datagram.length) {
            return Optional.empty();
        }
        String envelope = new String(datagram, 0, length, StandardCharsets.UTF_8);
        String[] parts = envelope.split(" ", 8);
        if (parts.length != 8 || !"-".equals(parts[6])) {
            return Optional.empty();
        }
        Matcher priority = PRIORITY_AND_VERSION.matcher(parts[0]);
        OperationalLogSource source = OperationalLogSource.fromSyslogTag(parts[3]);
        if (!priority.matches() || source == null) {
            return Optional.empty();
        }
        try {
            int priorityValue = Integer.parseInt(priority.group(1));
            if (priorityValue > 191) {
                return Optional.empty();
            }
            Instant.parse(parts[1]);
            return parseMessage(source, OperationalLogSeverity.fromSyslogPriority(priorityValue), parts[7]);
        } catch (DateTimeParseException | NumberFormatException exception) {
            return Optional.empty();
        }
    }

    private Optional<OperationalLogRecord> parseMessage(
            OperationalLogSource source,
            OperationalLogSeverity envelopeSeverity,
            String rawMessage) {
        if (rawMessage.isBlank() || rawMessage.length() > MAX_MESSAGE_CHARACTERS) {
            return Optional.empty();
        }
        OperationalLogSeverity severity = envelopeSeverity;
        String message = rawMessage;
        String traceId = null;
        if (source == OperationalLogSource.APPLICATION && rawMessage.startsWith("{")) {
            try {
                JsonNode ecs = JSON.readTree(rawMessage);
                JsonNode messageNode = ecs.get("message");
                if (!ecs.isObject() || messageNode == null || !messageNode.isTextual()) {
                    return Optional.empty();
                }
                message = messageNode.textValue();
                severity = OperationalLogSeverity.fromText(ecs.at("/log/level").textValue(), envelopeSeverity);
                traceId = textual(ecs.get("traceId"));
                if (traceId == null) {
                    traceId = textual(ecs.at("/trace/id"));
                }
            } catch (Exception exception) {
                return Optional.empty();
            }
        }
        if (message.isBlank() || message.length() > MAX_MESSAGE_CHARACTERS) {
            return Optional.empty();
        }
        String safeMessage = OperationalLogRedactor.redact(message);
        String safeTraceId = traceId == null ? null : OperationalLogRedactor.safeTraceId(traceId);
        return Optional.of(new OperationalLogRecord(
                UUID.randomUUID(), clock.instant(), source, severity, safeMessage, safeTraceId));
    }

    private static String textual(JsonNode node) {
        return node != null && node.isTextual() && !node.textValue().isBlank() ? node.textValue() : null;
    }
}
