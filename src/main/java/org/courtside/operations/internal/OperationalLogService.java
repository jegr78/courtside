package org.courtside.operations.internal;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class OperationalLogService {

    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_FILES = 10;
    private static final int MAX_SCAN_BYTES = 10 * 1024 * 1024;
    private static final int MAX_RECORDS = 50_000;
    private static final int MAX_MESSAGE_CHARACTERS = 8_192;
    private static final Duration COLLECTOR_HEARTBEAT_TTL = Duration.ofSeconds(30);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Comparator<Entry> NEWEST_FIRST = Comparator.comparing(Entry::occurredAt)
            .thenComparing(Entry::id)
            .reversed();

    private final Path directory;
    private final Clock clock;

    @Autowired
    public OperationalLogService(
            @Value("${courtside.operational-logs.path:/var/lib/courtside/operational-logs}") String directory) {
        this(Path.of(directory), Clock.systemUTC());
    }

    OperationalLogService(Path directory, Clock clock) {
        this.directory = directory;
        this.clock = clock;
    }

    public Page search(Query query) {
        int limit = query.limit() == null ? DEFAULT_PAGE_SIZE : query.limit();
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Operational log page limit is outside its supported bounds");
        }
        if (query.from() != null && query.to() != null && !query.from().isBefore(query.to())) {
            throw new OperationalLogRangeInvalidException();
        }
        CollectorEvidence evidence = collectorEvidence();
        if (evidence.availability() == Availability.UNAVAILABLE) {
            return new Page(List.of(), null, evidence.availability(), false,
                    true, evidence.droppedRecords(), null);
        }

        ReadResult read = readEntries();
        List<Entry> all = new ArrayList<>(read.entries());
        all.sort(NEWEST_FIRST);
        Instant oldest = all.stream().map(Entry::occurredAt).min(Instant::compareTo).orElse(null);
        List<Entry> matches = all.stream().filter(entry -> matches(entry, query)).toList();
        int start = startIndex(matches, query.cursor());
        int end = Math.min(start + limit, matches.size());
        List<Entry> page = matches.subList(start, end);
        UUID nextCursor = end < matches.size() && !page.isEmpty() ? page.getLast().id() : null;
        return new Page(page, nextCursor, evidence.availability(), evidence.rotations() > 0,
                read.incomplete(), evidence.droppedRecords(), oldest);
    }

    private CollectorEvidence collectorEvidence() {
        Path status = directory.resolve(OperationalLogStore.STATUS_FILE);
        if (!safeRegularFile(status)) {
            return new CollectorEvidence(Availability.UNAVAILABLE, 0, 0);
        }
        try {
            byte[] statusBytes;
            try (InputStream input = Files.newInputStream(status)) {
                statusBytes = input.readNBytes(OperationalLogStore.MAX_STATUS_BYTES + 1);
            }
            if (statusBytes.length > OperationalLogStore.MAX_STATUS_BYTES) {
                return new CollectorEvidence(Availability.UNAVAILABLE, 0, 0);
            }
            JsonNode value = JSON.readTree(statusBytes);
            if (value == null || value.path("version").asInt() != 1) {
                return new CollectorEvidence(Availability.UNAVAILABLE, 0, 0);
            }
            Instant updatedAt = Instant.parse(value.path("updatedAt").asText());
            if (updatedAt.isBefore(clock.instant().minus(COLLECTOR_HEARTBEAT_TTL))
                    || updatedAt.isAfter(clock.instant().plus(COLLECTOR_HEARTBEAT_TTL))) {
                return new CollectorEvidence(Availability.UNAVAILABLE, 0, 0);
            }
            return new CollectorEvidence(Availability.AVAILABLE,
                    Math.max(0, value.path("dropped").asLong()),
                    Math.max(0, value.path("rotations").asLong()));
        } catch (Exception exception) {
            return new CollectorEvidence(Availability.UNAVAILABLE, 0, 0);
        }
    }

    private ReadResult readEntries() {
        List<Entry> entries = new ArrayList<>();
        int remainingBytes = MAX_SCAN_BYTES;
        boolean incomplete = false;
        for (int index = 0; index < MAX_FILES && remainingBytes > 0 && entries.size() < MAX_RECORDS; index++) {
            Path file = directory.resolve(index == 0
                    ? OperationalLogStore.ACTIVE_FILE
                    : OperationalLogStore.ACTIVE_FILE + "." + index);
            if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
                continue;
            }
            if (!safeRegularFile(file)) {
                incomplete = true;
                continue;
            }
            try (InputStream input = Files.newInputStream(file)) {
                byte[] bytes = input.readNBytes(remainingBytes + 1);
                boolean cut = bytes.length > remainingBytes;
                int acceptedBytes = Math.min(bytes.length, remainingBytes);
                remainingBytes -= acceptedBytes;
                String content = new String(bytes, 0, acceptedBytes, StandardCharsets.UTF_8);
                String[] lines = content.split("\\n", -1);
                int completeLines = cut ? Math.max(0, lines.length - 1) : lines.length;
                for (int line = 0; line < completeLines && entries.size() < MAX_RECORDS; line++) {
                    if (lines[line].isBlank()) {
                        continue;
                    }
                    Entry parsed = parseStored(lines[line]);
                    if (parsed == null) {
                        incomplete = true;
                    } else {
                        entries.add(parsed);
                    }
                }
                incomplete |= cut;
            } catch (IOException exception) {
                incomplete = true;
            }
        }
        if (remainingBytes == 0 || entries.size() == MAX_RECORDS) {
            incomplete = true;
        }
        return new ReadResult(entries, incomplete);
    }

    private Entry parseStored(String line) {
        try {
            JsonNode value = JSON.readTree(line);
            if (value == null || value.path("version").asInt() != 1
                    || !value.path("message").isTextual()) {
                return null;
            }
            String message = value.path("message").asText();
            if (message.isBlank() || message.length() > MAX_MESSAGE_CHARACTERS) {
                return null;
            }
            String traceId = value.path("traceId").isTextual() ? value.path("traceId").asText() : null;
            if (traceId != null && traceId.length() > 256) {
                return null;
            }
            return new Entry(
                    UUID.fromString(value.path("id").asText()),
                    Instant.parse(value.path("occurredAt").asText()),
                    OperationalLogSource.valueOf(value.path("source").asText()),
                    OperationalLogSeverity.valueOf(value.path("severity").asText()),
                    OperationalLogRedactor.redact(message),
                    traceId == null ? null : OperationalLogRedactor.safeTraceId(traceId));
        } catch (IllegalArgumentException | tools.jackson.core.JacksonException exception) {
            return null;
        }
    }

    private boolean safeRegularFile(Path file) {
        return file.normalize().getParent().equals(directory.normalize())
                && !Files.isSymbolicLink(file)
                && Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS);
    }

    private static boolean matches(Entry entry, Query query) {
        if (query.source() != null && entry.source() != query.source()) {
            return false;
        }
        if (query.severity() != null && entry.severity() != query.severity()) {
            return false;
        }
        if (query.from() != null && entry.occurredAt().isBefore(query.from())) {
            return false;
        }
        if (query.to() != null && !entry.occurredAt().isBefore(query.to())) {
            return false;
        }
        if (query.text() != null && !query.text().isBlank()
                && !entry.message().toLowerCase(Locale.ROOT).contains(query.text().toLowerCase(Locale.ROOT))) {
            return false;
        }
        return query.traceId() == null || query.traceId().isBlank()
                || query.traceId().equalsIgnoreCase(entry.traceId());
    }

    private static int startIndex(List<Entry> entries, UUID cursor) {
        if (cursor == null) {
            return 0;
        }
        for (int index = 0; index < entries.size(); index++) {
            if (entries.get(index).id().equals(cursor)) {
                return index + 1;
            }
        }
        throw new OperationalLogCursorUnknownException();
    }

    public enum Availability {
        AVAILABLE,
        UNAVAILABLE
    }

    public record Query(
            OperationalLogSource source,
            OperationalLogSeverity severity,
            Instant from,
            Instant to,
            String text,
            String traceId,
            UUID cursor,
            Integer limit) {

        static Query unfiltered(UUID cursor, Integer limit) {
            return new Query(null, null, null, null, null, null, cursor, limit);
        }
    }

    public record Entry(
            UUID id,
            Instant occurredAt,
            OperationalLogSource source,
            OperationalLogSeverity severity,
            String message,
            String traceId) {
    }

    public record Page(
            List<Entry> entries,
            UUID nextCursor,
            Availability availability,
            boolean retentionTruncated,
            boolean searchIncomplete,
            long droppedRecords,
            Instant oldestAvailableAt) {

        public Page {
            entries = List.copyOf(entries);
        }
    }

    private record CollectorEvidence(Availability availability, long droppedRecords, long rotations) {
    }

    private record ReadResult(List<Entry> entries, boolean incomplete) {
    }
}
