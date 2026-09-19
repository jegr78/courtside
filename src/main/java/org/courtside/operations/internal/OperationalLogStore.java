package org.courtside.operations.internal;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

final class OperationalLogStore {

    static final String ACTIVE_FILE = "operational.log";
    static final String STATUS_FILE = "collector-status.json";
    static final int MAX_STATUS_BYTES = 4_096;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final Path directory;
    private final long maxFileBytes;
    private final int maxFiles;
    private CollectorStatus status;

    OperationalLogStore(Path directory, long maxFileBytes, int maxFiles) throws IOException {
        if (maxFileBytes < 1 || maxFiles < 1) {
            throw new IllegalStateException("Operational log bounds must be positive");
        }
        this.directory = directory;
        this.maxFileBytes = maxFileBytes;
        this.maxFiles = maxFiles;
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory)) {
            throw new IOException("Operational log directory must not be a symbolic link");
        }
        status = readStatus();
        writeStatus();
    }

    synchronized void append(OperationalLogRecord record) throws IOException {
        byte[] line = serialized(record);
        if (line.length > maxFileBytes) {
            status = status.droppedNow();
            return;
        }
        Path active = safeFile(ACTIVE_FILE);
        if (Files.exists(active, LinkOption.NOFOLLOW_LINKS) && Files.size(active) + line.length > maxFileBytes) {
            rotate();
        }
        Files.write(active, line, java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
        status = status.acceptedNow();
    }

    synchronized void dropped() throws IOException {
        status = status.droppedNow();
    }

    synchronized void heartbeat() throws IOException {
        status = status.heartbeatNow();
        writeStatus();
    }

    synchronized CollectorStatus status() {
        return status;
    }

    private void rotate() throws IOException {
        if (maxFiles == 1) {
            Files.deleteIfExists(safeFile(ACTIVE_FILE));
        } else {
            Files.deleteIfExists(safeFile(ACTIVE_FILE + "." + (maxFiles - 1)));
            for (int index = maxFiles - 2; index >= 1; index--) {
                Path source = safeFile(ACTIVE_FILE + "." + index);
                if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) {
                    Files.move(source, safeFile(ACTIVE_FILE + "." + (index + 1)),
                            StandardCopyOption.REPLACE_EXISTING);
                }
            }
            Files.move(safeFile(ACTIVE_FILE), safeFile(ACTIVE_FILE + ".1"),
                    StandardCopyOption.REPLACE_EXISTING);
        }
        status = status.rotatedNow();
    }

    private byte[] serialized(OperationalLogRecord record) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("version", 1);
        value.put("id", record.id().toString());
        value.put("occurredAt", record.occurredAt().toString());
        value.put("source", record.source().name());
        value.put("severity", record.severity().name());
        value.put("message", record.message());
        if (record.traceId() != null) {
            value.put("traceId", record.traceId());
        }
        return (JSON.writeValueAsString(value) + "\n").getBytes(StandardCharsets.UTF_8);
    }

    private CollectorStatus readStatus() throws IOException {
        Path file = safeFile(STATUS_FILE);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            return new CollectorStatus(0, 0, 0, Instant.now());
        }
        byte[] statusBytes;
        try (InputStream input = Files.newInputStream(file)) {
            statusBytes = input.readNBytes(MAX_STATUS_BYTES + 1);
        }
        if (statusBytes.length > MAX_STATUS_BYTES) {
            throw new IOException("Operational log collector status exceeds its bound");
        }
        JsonNode value = JSON.readTree(statusBytes);
        if (value == null || value.path("version").asInt() != 1) {
            throw new IOException("Unsupported operational log collector status");
        }
        return new CollectorStatus(
                value.path("accepted").asLong(),
                value.path("dropped").asLong(),
                value.path("rotations").asLong(),
                Instant.parse(value.path("updatedAt").asText()));
    }

    private void writeStatus() throws IOException {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("version", 1);
        value.put("accepted", status.accepted());
        value.put("dropped", status.dropped());
        value.put("rotations", status.rotations());
        value.put("updatedAt", status.updatedAt().toString());
        Path temporary = safeFile(STATUS_FILE + ".tmp");
        Files.writeString(temporary, JSON.writeValueAsString(value), StandardCharsets.UTF_8);
        Files.move(temporary, safeFile(STATUS_FILE), StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
    }

    private Path safeFile(String name) throws IOException {
        Path file = directory.resolve(name);
        if (!file.normalize().getParent().equals(directory.normalize()) || Files.isSymbolicLink(file)) {
            throw new IOException("Unsafe operational log path");
        }
        return file;
    }

    record CollectorStatus(long accepted, long dropped, long rotations, Instant updatedAt) {

        CollectorStatus acceptedNow() {
            return new CollectorStatus(accepted + 1, dropped, rotations, Instant.now());
        }

        CollectorStatus droppedNow() {
            return new CollectorStatus(accepted, dropped + 1, rotations, Instant.now());
        }

        CollectorStatus rotatedNow() {
            return new CollectorStatus(accepted, dropped, rotations + 1, Instant.now());
        }

        CollectorStatus heartbeatNow() {
            return new CollectorStatus(accepted, dropped, rotations, Instant.now());
        }
    }
}
