package org.courtside.operations.internal;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Arrays;
import java.util.Map;

public final class OperationalLogCollector {

    private static final String MODE = "--collect-operational-logs";
    private static final int HEARTBEAT_INTERVAL_MILLIS = 10_000;
    static final int MAX_RECORDS_PER_SECOND = 50;

    private final DatagramSocket socket;
    private final OperationalLogParser parser;
    private final OperationalLogStore store;
    private final Clock clock;
    private long rateWindowSecond = Long.MIN_VALUE;
    private int recordsInRateWindow;

    OperationalLogCollector(DatagramSocket socket, OperationalLogParser parser, OperationalLogStore store) {
        this(socket, parser, store, Clock.systemUTC());
    }

    OperationalLogCollector(
            DatagramSocket socket,
            OperationalLogParser parser,
            OperationalLogStore store,
            Clock clock) {
        this.socket = socket;
        this.parser = parser;
        this.store = store;
        this.clock = clock;
    }

    public static boolean requested(String[] arguments) {
        return Arrays.asList(arguments).contains(MODE);
    }

    public static void run(Map<String, String> environment) {
        Configuration configuration = Configuration.from(environment);
        try (DatagramSocket socket = new DatagramSocket(new InetSocketAddress("0.0.0.0", configuration.port()))) {
            socket.setSoTimeout(HEARTBEAT_INTERVAL_MILLIS);
            OperationalLogStore store = new OperationalLogStore(
                    configuration.directory(), configuration.maxFileBytes(), configuration.maxFiles());
            OperationalLogCollector collector = new OperationalLogCollector(socket, new OperationalLogParser(), store);
            System.out.printf("Operational log collector listening on UDP port %d%n", configuration.port());
            while (!Thread.currentThread().isInterrupted()) {
                collector.receiveOne();
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Operational log collector stopped", exception);
        }
    }

    void receiveOne() {
        byte[] buffer = new byte[OperationalLogParser.MAX_DATAGRAM_BYTES + 1];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        try {
            socket.receive(packet);
            if (!admit()) {
                store.dropped();
                return;
            }
            var parsed = parser.parse(packet.getData(), packet.getLength());
            if (parsed.isPresent()) {
                store.append(parsed.orElseThrow());
            } else {
                store.dropped();
            }
        } catch (SocketTimeoutException exception) {
            try {
                store.heartbeat();
            } catch (IOException heartbeatFailure) {
                throw new IllegalStateException("Cannot refresh operational log collector heartbeat", heartbeatFailure);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Cannot collect operational log record", exception);
        }
    }

    private boolean admit() throws IOException {
        long second = clock.instant().getEpochSecond();
        if (rateWindowSecond != second) {
            if (rateWindowSecond != Long.MIN_VALUE) {
                store.heartbeat();
            }
            rateWindowSecond = second;
            recordsInRateWindow = 0;
        }
        if (recordsInRateWindow >= MAX_RECORDS_PER_SECOND) {
            return false;
        }
        recordsInRateWindow++;
        return true;
    }

    record Configuration(Path directory, int port, long maxFileBytes, int maxFiles) {

        private static final Path DEFAULT_DIRECTORY = Path.of("/var/lib/courtside/operational-logs");
        private static final int DEFAULT_PORT = 1514;
        private static final long DEFAULT_FILE_SIZE = 2L * 1024 * 1024;
        private static final int DEFAULT_FILES = 5;

        static Configuration from(Map<String, String> environment) {
            Path directory = Path.of(environment.getOrDefault(
                    "COURTSIDE_OPERATIONAL_LOG_PATH", DEFAULT_DIRECTORY.toString()));
            int port = integer(environment, "COURTSIDE_OPERATIONAL_LOG_PORT", DEFAULT_PORT, 1, 65_535);
            long maxFileBytes = integer(environment, "COURTSIDE_OPERATIONAL_LOG_FILE_SIZE",
                    DEFAULT_FILE_SIZE, 1_024, 10L * 1024 * 1024);
            int maxFiles = integer(environment, "COURTSIDE_OPERATIONAL_LOG_FILES", DEFAULT_FILES, 1, 10);
            return new Configuration(directory, port, maxFileBytes, maxFiles);
        }

        private static int integer(Map<String, String> environment, String name, int fallback, int minimum, int maximum) {
            return Math.toIntExact(integer(environment, name, (long) fallback, minimum, maximum));
        }

        private static long integer(Map<String, String> environment, String name, long fallback, long minimum, long maximum) {
            String configured = environment.get(name);
            long value;
            try {
                value = configured == null || configured.isBlank() ? fallback : Long.parseLong(configured);
            } catch (NumberFormatException exception) {
                throw new IllegalStateException(name + " must be an integer", exception);
            }
            if (value < minimum || value > maximum) {
                throw new IllegalStateException(name + " is outside its supported bounds");
            }
            return value;
        }
    }
}
