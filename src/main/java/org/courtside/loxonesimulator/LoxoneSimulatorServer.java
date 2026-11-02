package org.courtside.loxonesimulator;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Arrays;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.stream.Collectors;

/** Serves the simulated Miniserver over plain HTTP and lets an operator select a failure on a loopback port. */
@Slf4j
public final class LoxoneSimulatorServer implements AutoCloseable {

    public static final int DEVICE_PORT = 8080;
    public static final int CONTROL_PORT = 8081;
    private static final int MOST_BODY_BYTES = 64;

    private final LoxoneSimulator device;
    private final HttpServer control;

    LoxoneSimulatorServer(InetSocketAddress deviceAddress, InetSocketAddress controlAddress) throws IOException {
        device = new LoxoneSimulator(Clock.systemUTC(), listener -> HttpServer.create(
                listener == LoxoneSimulator.Listener.MINISERVER ? deviceAddress
                        : new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0));
        device.stopRecording();
        try {
            control = HttpServer.create(controlAddress, 0);
        } catch (IOException | RuntimeException refused) {
            device.close();
            throw refused;
        }
        control.createContext("/failure", exchange -> {
            try (exchange) {
                select(exchange);
            }
        });
        control.start();
    }

    public static void main(String[] arguments) throws IOException, InterruptedException {
        try (LoxoneSimulatorServer ignored = new LoxoneSimulatorServer(new InetSocketAddress(DEVICE_PORT),
                new InetSocketAddress(InetAddress.getLoopbackAddress(), CONTROL_PORT))) {
            log.info("Loxone simulator answers on port {}; its codes open no door", DEVICE_PORT);
            new CountDownLatch(1).await();
        }
    }

    LoxoneSimulator device() {
        return device;
    }

    int controlPort() {
        return control.getAddress().getPort();
    }

    private void select(HttpExchange exchange) throws IOException {
        switch (exchange.getRequestMethod()) {
            case "GET" -> respond(exchange, 200, device.failure().label());
            case "PUT" -> {
                byte[] body = exchange.getRequestBody().readNBytes(MOST_BODY_BYTES);
                Optional<Failure> named = Failure.named(new String(body, StandardCharsets.UTF_8));
                if (named.isEmpty()) {
                    respond(exchange, 400, "unknown failure; expected one of " + Arrays.stream(Failure.values())
                            .map(Failure::label).collect(Collectors.joining(", ")));
                    return;
                }
                device.fail(named.get());
                log.info("Loxone simulator now plays {}", named.get());
                respond(exchange, 200, named.get().label());
            }
            default -> respond(exchange, 405, "GET or PUT");
        }
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = (body + "\n").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Override
    public void close() {
        control.stop(0);
        device.close();
    }
}
