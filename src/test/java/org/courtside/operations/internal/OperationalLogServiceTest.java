package org.courtside.operations.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OperationalLogServiceTest {

    @TempDir
    Path directory;

    @Test
    void givenCombinedCriteria_whenSearching_thenOnlyMatchingEntriesAreReturnedNewestFirst() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 8_192, 5);
        String traceId = "0123456789abcdef0123456789abcdef";
        store.append(record("2026-09-19T12:00:00Z", OperationalLogSource.APPLICATION,
                OperationalLogSeverity.ERROR, "role update failed", traceId));
        store.append(record("2026-09-19T12:01:00Z", OperationalLogSource.APPLICATION,
                OperationalLogSeverity.INFO, "role update completed", traceId));
        store.append(record("2026-09-19T12:02:00Z", OperationalLogSource.DATABASE,
                OperationalLogSeverity.ERROR, "connection failed", traceId));
        OperationalLogService service = new OperationalLogService(directory.toString());

        OperationalLogService.Page page = service.search(new OperationalLogService.Query(
                OperationalLogSource.APPLICATION, OperationalLogSeverity.ERROR,
                Instant.parse("2026-09-19T11:59:00Z"), Instant.parse("2026-09-19T12:01:00Z"),
                "ROLE UPDATE", traceId, null, 50));

        assertThat(page.availability()).isEqualTo(OperationalLogService.Availability.AVAILABLE);
        assertThat(page.entries()).extracting(OperationalLogService.Entry::message)
                .containsExactly("role update failed");
        assertThat(page.nextCursor()).isNull();
        assertThat(page.searchIncomplete()).isFalse();
    }

    @Test
    void givenMoreMatchesThanThePageLimit_whenContinuing_thenEntriesDoNotRepeat() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 8_192, 5);
        OperationalLogRecord old = record("2026-09-19T12:00:00Z", OperationalLogSource.PROXY,
                OperationalLogSeverity.INFO, "old", null);
        OperationalLogRecord middle = record("2026-09-19T12:01:00Z", OperationalLogSource.PROXY,
                OperationalLogSeverity.INFO, "middle", null);
        OperationalLogRecord newest = record("2026-09-19T12:02:00Z", OperationalLogSource.PROXY,
                OperationalLogSeverity.INFO, "newest", null);
        store.append(old);
        store.append(middle);
        store.append(newest);
        OperationalLogService service = new OperationalLogService(directory.toString());

        OperationalLogService.Page first = service.search(OperationalLogService.Query.unfiltered(null, 2));
        OperationalLogService.Page second = service.search(
                OperationalLogService.Query.unfiltered(first.nextCursor(), 2));

        assertThat(first.entries()).extracting(OperationalLogService.Entry::id)
                .containsExactly(newest.id(), middle.id());
        assertThat(second.entries()).extracting(OperationalLogService.Entry::id).containsExactly(old.id());
    }

    @Test
    void givenNoCollectorStatus_whenSearching_thenCollectionIsUnavailableRatherThanEmpty() {
        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.availability()).isEqualTo(OperationalLogService.Availability.UNAVAILABLE);
        assertThat(page.entries()).isEmpty();
    }

    @Test
    void givenAStaleCollectorHeartbeat_whenSearching_thenCollectionIsUnavailableRatherThanEmpty() throws Exception {
        new OperationalLogStore(directory, 8_192, 5);
        String staleStatus = Files.readString(directory.resolve(OperationalLogStore.STATUS_FILE))
                .replaceAll("\"updatedAt\":\"[^\"]+\"", "\"updatedAt\":\"2026-09-19T11:59:00Z\"");
        Files.writeString(directory.resolve(OperationalLogStore.STATUS_FILE), staleStatus);
        Clock now = Clock.fixed(Instant.parse("2026-09-19T12:00:00Z"), ZoneOffset.UTC);

        OperationalLogService.Page page = new OperationalLogService(directory, now)
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.availability()).isEqualTo(OperationalLogService.Availability.UNAVAILABLE);
        assertThat(page.entries()).isEmpty();
    }

    @Test
    void givenAnOversizedCollectorStatus_whenSearching_thenItIsRejectedWithoutReadingRecords() throws Exception {
        Files.writeString(directory.resolve(OperationalLogStore.STATUS_FILE), "x".repeat(8_192));
        Files.writeString(directory.resolve(OperationalLogStore.ACTIVE_FILE), "not-safe-to-read\n");

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.availability()).isEqualTo(OperationalLogService.Availability.UNAVAILABLE);
        assertThat(page.entries()).isEmpty();
    }

    @Test
    void givenRotationAndDroppedInput_whenSearching_thenTheEvidenceLimitsAreVisible() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 260, 2);
        for (int index = 0; index < 4; index++) {
            store.append(record("2026-09-19T12:00:0" + index + "Z", OperationalLogSource.DATABASE,
                    OperationalLogSeverity.INFO, "message-" + index, null));
        }
        store.dropped();
        store.heartbeat();

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.retentionTruncated()).isTrue();
        assertThat(page.droppedRecords()).isEqualTo(1);
        assertThat(page.oldestAvailableAt()).isNotNull();
    }

    @Test
    void givenACorruptStoredLine_whenSearching_thenItIsSkippedAndTheResultIsMarkedIncomplete() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 8_192, 5);
        store.append(record("2026-09-19T12:00:00Z", OperationalLogSource.APPLICATION,
                OperationalLogSeverity.INFO, "valid", null));
        Files.writeString(directory.resolve("operational.log"), "not-json\n",
                java.nio.file.StandardOpenOption.APPEND);

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.entries()).extracting(OperationalLogService.Entry::message).containsExactly("valid");
        assertThat(page.searchIncomplete()).isTrue();
    }

    @Test
    void givenLegacyStoredSecrets_whenSearching_thenReadSideRedactionStillRemovesThem() throws Exception {
        new OperationalLogStore(directory, 8_192, 5);
        Files.writeString(directory.resolve(OperationalLogStore.ACTIVE_FILE), """
                {"version":1,"id":"11111111-2222-3333-4444-555555555555",\
                "occurredAt":"2026-09-19T12:00:00Z","source":"PROXY","severity":"ERROR",\
                "message":"target=https://alice:pw@db.example/private requestBody=pin 1234\\nmedical=asthma"}
                """);

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.entries()).singleElement().extracting(OperationalLogService.Entry::message)
                .asString()
                .doesNotContain("alice", "pw", "pin 1234", "medical", "asthma")
                .contains("https://db.example/<redacted>", "requestBody=[REDACTED]");
    }

    @Test
    void givenAStaleCursor_whenSearching_thenTheRequestFailsExplicitly() throws Exception {
        new OperationalLogStore(directory, 8_192, 5);
        OperationalLogService service = new OperationalLogService(directory.toString());

        assertThatThrownBy(() -> service.search(
                OperationalLogService.Query.unfiltered(UUID.randomUUID(), 50)))
                .isInstanceOf(OperationalLogCursorUnknownException.class);
    }

    @Test
    void givenUnsupportedPagingOrTimeBounds_whenSearching_thenTheRequestFailsClosed() throws Exception {
        new OperationalLogStore(directory, 8_192, 5);
        OperationalLogService service = new OperationalLogService(directory.toString());

        assertThatThrownBy(() -> service.search(OperationalLogService.Query.unfiltered(null, 0)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> service.search(OperationalLogService.Query.unfiltered(null, 101)))
                .isInstanceOf(IllegalStateException.class);
        Instant boundary = Instant.parse("2026-09-19T12:00:00Z");
        assertThatThrownBy(() -> service.search(new OperationalLogService.Query(
                null, null, boundary, boundary, null, null, null, null)))
                .isInstanceOf(OperationalLogRangeInvalidException.class);
    }

    @Test
    void givenMalformedOrFutureCollectorEvidence_whenSearching_thenCollectionIsUnavailable() throws Exception {
        Path status = directory.resolve(OperationalLogStore.STATUS_FILE);
        Files.writeString(status, "{\"version\":2}");
        OperationalLogService service = new OperationalLogService(directory,
                Clock.fixed(Instant.parse("2026-09-19T12:00:00Z"), ZoneOffset.UTC));

        assertThat(service.search(OperationalLogService.Query.unfiltered(null, null)).availability())
                .isEqualTo(OperationalLogService.Availability.UNAVAILABLE);

        Files.writeString(status, """
                {"version":1,"updatedAt":"2026-09-19T12:01:00Z","dropped":-2,"rotations":-3}
                """);
        assertThat(service.search(OperationalLogService.Query.unfiltered(null, null)).availability())
                .isEqualTo(OperationalLogService.Availability.UNAVAILABLE);
    }

    @Test
    void givenNegativeCollectorCounters_whenSearching_thenTheyAreClampedAtZero() throws Exception {
        Files.writeString(directory.resolve(OperationalLogStore.STATUS_FILE), """
                {"version":1,"updatedAt":"2026-09-19T12:00:00Z","dropped":-2,"rotations":-3}
                """);
        OperationalLogService service = new OperationalLogService(directory,
                Clock.fixed(Instant.parse("2026-09-19T12:00:00Z"), ZoneOffset.UTC));

        OperationalLogService.Page page = service.search(OperationalLogService.Query.unfiltered(null, null));

        assertThat(page.availability()).isEqualTo(OperationalLogService.Availability.AVAILABLE);
        assertThat(page.droppedRecords()).isZero();
        assertThat(page.retentionTruncated()).isFalse();
    }

    @Test
    void givenBlankAndDifferentTraceFilters_whenSearching_thenTheirMeaningIsExplicit() throws Exception {
        OperationalLogStore store = new OperationalLogStore(directory, 8_192, 5);
        store.append(record("2026-09-19T12:00:00Z", OperationalLogSource.APPLICATION,
                OperationalLogSeverity.INFO, "ready", "0123456789abcdef0123456789abcdef"));
        OperationalLogService service = new OperationalLogService(directory.toString());

        OperationalLogService.Page blank = service.search(new OperationalLogService.Query(
                null, null, null, null, null, " ", null, 50));
        OperationalLogService.Page different = service.search(new OperationalLogService.Query(
                null, null, null, null, null, "fedcba9876543210fedcba9876543210", null, 50));

        assertThat(blank.entries()).hasSize(1);
        assertThat(different.entries()).isEmpty();
    }

    @Test
    void givenUnsafeAndMalformedStoredRecords_whenSearching_thenTheyAreSkippedAndReported() throws Exception {
        new OperationalLogStore(directory, 20_000, 5);
        Path active = directory.resolve(OperationalLogStore.ACTIVE_FILE);
        Files.writeString(active, """
                {"version":2,"message":"wrong version"}
                {"version":1,"message":""}
                {"version":1,"message":"%s"}
                {"version":1,"id":"11111111-2222-3333-4444-555555555555","occurredAt":"2026-09-19T12:00:00Z","source":"PROXY","severity":"INFO","message":"ok","traceId":"%s"}
                {"version":1,"id":"not-a-uuid","occurredAt":"2026-09-19T12:00:00Z","source":"PROXY","severity":"INFO","message":"ok"}
                """.formatted("x".repeat(8_193), "a".repeat(257)));

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, null));

        assertThat(page.entries()).isEmpty();
        assertThat(page.searchIncomplete()).isTrue();
    }

    @Test
    void givenASymbolicLinkInTheLogSet_whenSearching_thenItIsNeverFollowed() throws Exception {
        new OperationalLogStore(directory, 8_192, 5);
        Path outside = directory.resolve("outside.jsonl");
        Files.writeString(outside, "secret");
        Files.createSymbolicLink(directory.resolve(OperationalLogStore.ACTIVE_FILE + ".1"), outside);

        OperationalLogService.Page page = new OperationalLogService(directory.toString())
                .search(OperationalLogService.Query.unfiltered(null, 50));

        assertThat(page.entries()).isEmpty();
        assertThat(page.searchIncomplete()).isTrue();
    }

    private static OperationalLogRecord record(
            String occurredAt,
            OperationalLogSource source,
            OperationalLogSeverity severity,
            String message,
            String traceId) {
        return new OperationalLogRecord(UUID.randomUUID(), Instant.parse(occurredAt), source, severity, message, traceId);
    }
}
