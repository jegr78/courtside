package org.courtside.operations.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;

// The operator's backup job writes this file; without it the instance cannot know a backup exists.
@Component
class BackupEvidence {

    static final int MAX_BYTES = 4_096;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String configured;

    BackupEvidence(@Value("${courtside.operations.backup-evidence-file:}") String configured) {
        this.configured = configured == null ? "" : configured.strip();
    }

    OperatorHealth.Backup evaluate(Instant now) {
        if (configured.isEmpty()) {
            return unavailable(CheckReason.NOT_CONFIGURED);
        }
        Path file = Path.of(configured);
        Instant completedAt;
        try {
            completedAt = completedAt(file);
        } catch (NoSuchFileException missing) {
            return unavailable(CheckReason.NOT_RECORDED);
        } catch (IOException | RuntimeException unreadable) {
            return new OperatorHealth.Backup(CheckState.FAILING, CheckReason.UNREADABLE, null, null, configured);
        }
        if (completedAt.isAfter(now)) {
            return new OperatorHealth.Backup(CheckState.FAILING, CheckReason.RECORDED_IN_THE_FUTURE, completedAt,
                    null, configured);
        }
        return new OperatorHealth.Backup(CheckState.OK, null, completedAt,
                Duration.between(completedAt, now).toSeconds(), null);
    }

    private static Instant completedAt(Path file) throws IOException {
        // Opening a pipe or a device would block the overview and every metric collection.
        if (!Files.readAttributes(file, BasicFileAttributes.class).isRegularFile()) {
            throw new IOException("The backup evidence is not a regular file");
        }
        byte[] content;
        try (InputStream input = Files.newInputStream(file)) {
            content = input.readNBytes(MAX_BYTES + 1);
        }
        if (content.length > MAX_BYTES) {
            throw new IOException("The backup evidence is larger than " + MAX_BYTES + " bytes");
        }
        JsonNode value = JSON.readTree(new String(content, StandardCharsets.UTF_8)).get("completedAt");
        if (value == null || !value.isString()) {
            throw new IOException("The backup evidence names no completedAt");
        }
        try {
            return Instant.parse(value.asString());
        } catch (DateTimeParseException invalid) {
            throw new IOException("The backup evidence carries no instant", invalid);
        }
    }

    private static OperatorHealth.Backup unavailable(CheckReason reason) {
        return new OperatorHealth.Backup(CheckState.UNAVAILABLE, reason, null, null, null);
    }
}
