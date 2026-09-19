package org.courtside.operations.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OperationalLogCollectorTest {

    @TempDir
    Path directory;

    @Test
    void givenAConfiguredCollector_whenADatagramArrives_thenOnlyTheRedactedRecordIsPersisted() throws Exception {
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress());
             DatagramSocket sender = new DatagramSocket()) {
            OperationalLogCollector collector = new OperationalLogCollector(
                    receiver, new OperationalLogParser(), new OperationalLogStore(directory, 4_096, 3));
            Thread receiving = Thread.ofPlatform().start(() -> collector.receiveOne());
            byte[] payload = ("<14>1 2026-09-19T14:00:00Z host courtside-database 1 - - "
                    + "password=hunter2 database ready").getBytes(StandardCharsets.UTF_8);

            sender.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getLoopbackAddress(), receiver.getLocalPort()));
            receiving.join(2_000);

            assertThat(receiving.isAlive()).isFalse();
            assertThat(Files.readString(directory.resolve("operational.log")))
                    .contains("database ready", "[REDACTED]")
                    .doesNotContain("hunter2");
        }
    }

    @Test
    void givenAnInvalidDatagram_whenCollecting_thenItIsCountedButNeverWritten() throws Exception {
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress());
             DatagramSocket sender = new DatagramSocket()) {
            OperationalLogStore store = new OperationalLogStore(directory, 4_096, 3);
            OperationalLogCollector collector = new OperationalLogCollector(receiver, new OperationalLogParser(), store);
            Thread receiving = Thread.ofPlatform().start(() -> collector.receiveOne());
            byte[] payload = "untrusted raw secret".getBytes(StandardCharsets.UTF_8);

            sender.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getLoopbackAddress(), receiver.getLocalPort()));
            receiving.join(2_000);

            assertThat(store.status().dropped()).isOne();
            assertThat(directory.resolve("operational.log")).doesNotExist();
        }
    }

    @Test
    void givenMoreThanThePerSecondLimit_whenCollecting_thenExcessRecordsAreDropped() throws Exception {
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress());
             DatagramSocket sender = new DatagramSocket()) {
            OperationalLogStore store = new OperationalLogStore(directory, 64_000, 3);
            Clock clock = Clock.fixed(Instant.parse("2026-09-19T15:00:00Z"), ZoneOffset.UTC);
            OperationalLogCollector collector = new OperationalLogCollector(
                    receiver, new OperationalLogParser(clock), store, clock);
            byte[] payload = ("<14>1 2026-09-19T14:00:00Z host courtside-application 1 - - ok")
                    .getBytes(StandardCharsets.UTF_8);

            for (int index = 0; index <= OperationalLogCollector.MAX_RECORDS_PER_SECOND; index++) {
                sender.send(new DatagramPacket(payload, payload.length,
                        InetAddress.getLoopbackAddress(), receiver.getLocalPort()));
                collector.receiveOne();
            }

            assertThat(Files.readAllLines(directory.resolve(OperationalLogStore.ACTIVE_FILE)))
                    .hasSize(OperationalLogCollector.MAX_RECORDS_PER_SECOND);
            assertThat(store.status().dropped()).isOne();
        }
    }

    @Test
    void givenNoDatagramBeforeTheSocketTimeout_whenCollecting_thenTheHeartbeatIsRefreshed() throws Exception {
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            receiver.setSoTimeout(10);
            OperationalLogStore store = new OperationalLogStore(directory, 4_096, 3);
            String before = Files.readString(directory.resolve(OperationalLogStore.STATUS_FILE));

            Thread.sleep(10);
            new OperationalLogCollector(receiver, new OperationalLogParser(), store).receiveOne();

            assertThat(Files.readString(directory.resolve(OperationalLogStore.STATUS_FILE))).isNotEqualTo(before);
        }
    }

    @Test
    void collectorModeIsAnExplicitArgument() {
        assertThat(OperationalLogCollector.requested(new String[]{"--collect-operational-logs"})).isTrue();
        assertThat(OperationalLogCollector.requested(new String[]{"--server.port=0"})).isFalse();
    }

    @Test
    void configurationDefaultsAreBoundedAndCanBeReduced() {
        OperationalLogCollector.Configuration defaults = OperationalLogCollector.Configuration.from(Map.of());
        OperationalLogCollector.Configuration reduced = OperationalLogCollector.Configuration.from(Map.of(
                "COURTSIDE_OPERATIONAL_LOG_PATH", directory.toString(),
                "COURTSIDE_OPERATIONAL_LOG_PORT", "1515",
                "COURTSIDE_OPERATIONAL_LOG_FILE_SIZE", "1024",
                "COURTSIDE_OPERATIONAL_LOG_FILES", "2"));

        assertThat(defaults.maxFileBytes()).isEqualTo(2 * 1024 * 1024);
        assertThat(defaults.maxFiles()).isEqualTo(5);
        assertThat(reduced.directory()).isEqualTo(directory);
        assertThat(reduced.port()).isEqualTo(1515);
        assertThat(reduced.maxFileBytes()).isEqualTo(1024);
        assertThat(reduced.maxFiles()).isEqualTo(2);
    }

    @Test
    void invalidCollectorConfigurationFailsBeforeTheSocketStarts() {
        assertThatThrownBy(() -> OperationalLogCollector.Configuration.from(Map.of(
                "COURTSIDE_OPERATIONAL_LOG_PORT", "not-a-port")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be an integer");
        assertThatThrownBy(() -> OperationalLogCollector.Configuration.from(Map.of(
                "COURTSIDE_OPERATIONAL_LOG_FILES", "11")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("outside its supported bounds");

        OperationalLogCollector.Configuration blank = OperationalLogCollector.Configuration.from(Map.of(
                "COURTSIDE_OPERATIONAL_LOG_PORT", " "));
        OperationalLogCollector.Configuration boundaries = OperationalLogCollector.Configuration.from(Map.of(
                "COURTSIDE_OPERATIONAL_LOG_PORT", "65535",
                "COURTSIDE_OPERATIONAL_LOG_FILE_SIZE", Integer.toString(10 * 1024 * 1024),
                "COURTSIDE_OPERATIONAL_LOG_FILES", "1"));
        assertThat(blank.port()).isEqualTo(1514);
        assertThat(boundaries.port()).isEqualTo(65_535);
    }

    @Test
    void givenAClosedSocket_whenCollecting_thenTheFailureIsExplicit() throws Exception {
        DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress());
        OperationalLogCollector collector = new OperationalLogCollector(
                receiver, new OperationalLogParser(), new OperationalLogStore(directory, 4_096, 3));
        receiver.close();

        assertThatThrownBy(collector::receiveOne)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Cannot collect operational log record");
    }

    @Test
    void givenAnUnavailablePort_whenStarting_thenTheFailureIsExplicit() throws Exception {
        try (DatagramSocket occupied = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            assertThatThrownBy(() -> OperationalLogCollector.run(Map.of(
                    "COURTSIDE_OPERATIONAL_LOG_PATH", directory.toString(),
                    "COURTSIDE_OPERATIONAL_LOG_PORT", Integer.toString(occupied.getLocalPort()))))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("collector stopped");
        }
    }

    @Test
    void givenARealCollectorRun_whenInterrupted_thenItFinishesAfterTheCurrentDatagram() throws Exception {
        int port;
        try (DatagramSocket candidate = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            port = candidate.getLocalPort();
        }
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread collector = Thread.ofPlatform().start(() -> {
            try {
                OperationalLogCollector.run(Map.of(
                        "COURTSIDE_OPERATIONAL_LOG_PATH", directory.toString(),
                        "COURTSIDE_OPERATIONAL_LOG_PORT", Integer.toString(port),
                        "COURTSIDE_OPERATIONAL_LOG_FILE_SIZE", "4096"));
            } catch (Throwable exception) {
                failure.set(exception);
            }
        });
        for (int attempt = 0; attempt < 100
                && !Files.exists(directory.resolve(OperationalLogStore.STATUS_FILE)); attempt++) {
            Thread.sleep(10);
        }

        collector.interrupt();
        try (DatagramSocket sender = new DatagramSocket()) {
            byte[] payload = ("<14>1 2026-09-19T14:00:00Z host courtside-proxy 1 - - ready")
                    .getBytes(StandardCharsets.UTF_8);
            sender.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getLoopbackAddress(), port));
        }
        collector.join(2_000);

        assertThat(collector.isAlive()).isFalse();
        assertThat(failure.get()).isNull();
        assertThat(Files.readString(directory.resolve(OperationalLogStore.ACTIVE_FILE))).contains("ready");
    }

    @Test
    void givenTheHeartbeatCannotBeWritten_whenTheSocketTimesOut_thenTheFailureIsExplicit() throws Exception {
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            receiver.setSoTimeout(10);
            OperationalLogStore store = new OperationalLogStore(directory, 4_096, 3);
            Path outside = directory.resolve("outside.tmp");
            Files.writeString(outside, "unchanged");
            Files.createSymbolicLink(directory.resolve(OperationalLogStore.STATUS_FILE + ".tmp"), outside);

            assertThatThrownBy(() -> new OperationalLogCollector(receiver, new OperationalLogParser(), store)
                    .receiveOne())
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Cannot refresh operational log collector heartbeat");
            assertThat(Files.readString(outside)).isEqualTo("unchanged");
        }
    }

    @Test
    void givenTheRateWindowAdvances_whenCollecting_thenTheCollectorRefreshesItsHeartbeat() throws Exception {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-09-19T15:00:00Z"));
        Clock clock = new Clock() {
            @Override
            public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                return now.get();
            }
        };
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getLoopbackAddress());
             DatagramSocket sender = new DatagramSocket()) {
            OperationalLogStore store = new OperationalLogStore(directory, 4_096, 3);
            OperationalLogCollector collector = new OperationalLogCollector(
                    receiver, new OperationalLogParser(clock), store, clock);
            byte[] payload = ("<14>1 2026-09-19T14:00:00Z host courtside-proxy 1 - - ready")
                    .getBytes(StandardCharsets.UTF_8);

            sender.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getLoopbackAddress(), receiver.getLocalPort()));
            collector.receiveOne();
            Instant before = store.status().updatedAt();
            now.set(now.get().plusSeconds(1));
            sender.send(new DatagramPacket(payload, payload.length,
                    InetAddress.getLoopbackAddress(), receiver.getLocalPort()));
            collector.receiveOne();

            assertThat(store.status().updatedAt()).isAfter(before);
        }
    }
}
