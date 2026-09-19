package org.courtside.operations.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OperationalLogStoreTest {

    @TempDir
    Path directory;

    @Test
    void givenTheActiveFileReachesItsBound_whenAppending_thenOnlyTheConfiguredFilesRemain() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 320, 3);

        for (int index = 0; index < 12; index++) {
            store.append(record(index));
        }
        store.heartbeat();

        assertThat(Files.list(directory)
                .filter(path -> path.getFileName().toString().startsWith("operational.log"))
                .toList()).hasSize(3);
        assertThat(store.status().rotations()).isGreaterThan(0);
        assertThat(Files.readString(directory.resolve("collector-status.json")))
                .contains("\"accepted\":12")
                .doesNotContain("message-0-");
    }

    @Test
    void givenARecordLargerThanTheFileBound_whenAppending_thenItIsDroppedWithoutWritingItsMessage() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 80, 3);
        OperationalLogRecord record = new OperationalLogRecord(UUID.randomUUID(), Instant.now(),
                OperationalLogSource.APPLICATION, OperationalLogSeverity.ERROR, "secret-" + "x".repeat(200), null);

        store.append(record);

        assertThat(store.status().accepted()).isZero();
        assertThat(store.status().dropped()).isOne();
        assertThat(directory.resolve("operational.log")).doesNotExist();
    }

    @Test
    void givenACollectorRestart_whenOpeningTheStore_thenCountersAndExistingRecordsArePreserved() throws Exception {
        OperationalLogStore first = new OperationalLogStore(directory, 1_024, 3);
        first.append(record(1));
        first.heartbeat();

        OperationalLogStore restarted = new OperationalLogStore(directory, 1_024, 3);
        restarted.append(record(2));

        assertThat(restarted.status().accepted()).isEqualTo(2);
        assertThat(Files.readAllLines(directory.resolve("operational.log"))).hasSize(2);
    }

    @Test
    void givenNoIncomingRecords_whenHeartbeatRuns_thenCollectorStatusIsRefreshed() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 1_024, 3);
        String before = Files.readString(directory.resolve(OperationalLogStore.STATUS_FILE));

        store.heartbeat();

        String after = Files.readString(directory.resolve(OperationalLogStore.STATUS_FILE));
        assertThat(after).isNotEqualTo(before);
        assertThat(store.status().accepted()).isZero();
        assertThat(store.status().dropped()).isZero();
    }

    @Test
    void givenInvalidBoundsOrASymbolicLinkDirectory_whenOpening_thenItFailsClosed() throws Exception {
        assertThatThrownBy(() -> new OperationalLogStore(directory, 0, 1))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new OperationalLogStore(directory, 1, 0))
                .isInstanceOf(IllegalStateException.class);

        Path target = Files.createDirectory(directory.resolve("target"));
        Path link = directory.resolve("linked");
        Files.createSymbolicLink(link, target);
        assertThatThrownBy(() -> new OperationalLogStore(link, 1_024, 1))
                .isInstanceOf(java.io.IOException.class);
    }

    @Test
    void givenOneRetainedFile_whenRotating_thenThePreviousFileIsRemoved() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 220, 1);

        store.append(record(1));
        store.append(record(2));

        assertThat(Files.list(directory)
                .filter(path -> path.getFileName().toString().startsWith(OperationalLogStore.ACTIVE_FILE))
                .toList()).hasSize(1);
        assertThat(store.status().rotations()).isOne();
    }

    @Test
    void givenAnInvalidSavedStatus_whenRestarting_thenItFailsClosed() throws Exception {
        Files.writeString(directory.resolve(OperationalLogStore.STATUS_FILE), "x".repeat(4_097));
        assertThatThrownBy(() -> new OperationalLogStore(directory, 1_024, 2))
                .isInstanceOf(java.io.IOException.class);

        Files.writeString(directory.resolve(OperationalLogStore.STATUS_FILE), "{\"version\":2}");
        assertThatThrownBy(() -> new OperationalLogStore(directory, 1_024, 2))
                .isInstanceOf(java.io.IOException.class);
    }

    @Test
    void givenASymbolicLinkForAnActiveFile_whenAppending_thenItIsNeverFollowed() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 1_024, 2);
        Path outside = directory.resolve("outside.jsonl");
        Files.writeString(outside, "unchanged");
        Files.createSymbolicLink(directory.resolve(OperationalLogStore.ACTIVE_FILE), outside);

        assertThatThrownBy(() -> store.append(record(1)))
                .isInstanceOf(java.io.IOException.class)
                .hasMessageContaining("Unsafe operational log path");
        assertThat(Files.readString(outside)).isEqualTo("unchanged");
    }

    private static OperationalLogRecord record(int index) {
        return new OperationalLogRecord(UUID.randomUUID(), Instant.parse("2026-09-19T14:00:00Z").plusSeconds(index),
                OperationalLogSource.APPLICATION, OperationalLogSeverity.INFO,
                "message-" + index + "-" + "x".repeat(24), "trace-" + index);
    }
}
