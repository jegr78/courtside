package org.courtside.payment;

import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

final class FakePayPal {

    static final String ORDER = "ORDER1";
    static final String APPROVE = "https://paypal.example.org/checkoutnow?token=ORDER1";
    static final String TOKEN = "POST /sandbox/v1/oauth2/token";
    static final String CREATE = "POST /sandbox/v2/checkout/orders";
    static final String READ = "GET /sandbox/v2/checkout/orders/" + ORDER;
    static final String CAPTURE = "POST /sandbox/v2/checkout/orders/" + ORDER + "/capture";

    static final String REFUND = "POST /sandbox/v2/payments/captures/CAPTURE1/refund";
    static final String REFUND_READ = "GET /sandbox/v2/payments/refunds/REFUND1";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private final Map<String, Deque<Reply>> replies = new ConcurrentHashMap<>();
    private final Map<String, CountDownLatch> held = new ConcurrentHashMap<>();
    private final Map<String, CountDownLatch> firstHeld = new ConcurrentHashMap<>();
    private final Map<String, Runnable> hooks = new ConcurrentHashMap<>();
    private final HttpServer server;

    FakePayPal() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException failed) {
            throw new UncheckedIOException(failed);
        }
        server.createContext("/", exchange -> {
            String route = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
            Map<String, String> headers = new ConcurrentHashMap<>();
            exchange.getRequestHeaders().forEach((name, values) ->
                    headers.put(name.toLowerCase(java.util.Locale.ROOT), String.join(",", values)));
            seen.add(new Seen(route, headers,
                    new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            Reply reply = next(route);
            Runnable hook = hooks.remove(route);
            if (hook != null) hook.run();
            CountDownLatch first = firstHeld.remove(route);
            if (first != null) await(first);
            CountDownLatch together = held.get(route);
            if (together != null) {
                together.countDown();
                await(together);
            }
            try {
                Thread.sleep(reply.delay().toMillis());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            byte[] answer = reply.body().getBytes(StandardCharsets.UTF_8);
            try {
                exchange.sendResponseHeaders(reply.status(), answer.length);
                exchange.getResponseBody().write(answer);
            } catch (IOException abandoned) {
                exchange.close();
                return;
            }
            exchange.close();
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
    }

    int port() {
        return server.getAddress().getPort();
    }

    void stop() {
        server.stop(0);
    }

    void reset() {
        seen.clear();
        replies.clear();
        held.clear();
        firstHeld.clear();
        hooks.clear();
    }

    /** Runs the action once while the next request for the route is being answered. */
    void onNext(String route, Runnable action) {
        hooks.put(route, action);
    }

    CountDownLatch holdFirst(String route) {
        CountDownLatch release = new CountDownLatch(1);
        firstHeld.put(route, release);
        return release;
    }

    void holdUntilBothArrive(String route) {
        held.put(route, new CountDownLatch(2));
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    void reply(String route, int status, String body) {
        replyAfter(route, status, body, Duration.ZERO);
    }

    void replaceReply(String route, int status, String body) {
        replies.remove(route);
        reply(route, status, body);
    }

    void replyAfter(String route, int status, String body, Duration delay) {
        replies.computeIfAbsent(route, key -> new ArrayDeque<>()).add(new Reply(status, body, delay));
    }

    List<Seen> all() {
        return List.copyOf(seen);
    }

    List<Seen> seen(String route) {
        return seen.stream().filter(request -> request.route().equals(route)).toList();
    }

    Seen only(String route) {
        assertThat(seen(route)).as("exactly one request for %s", route).hasSize(1);
        return seen(route).getFirst();
    }

    private synchronized Reply next(String route) {
        Deque<Reply> queue = replies.get(route);
        if (queue == null || queue.isEmpty()) return new Reply(404, "{}", Duration.ZERO);
        return queue.size() > 1 ? queue.poll() : queue.peek();
    }

    static String order(String status, UUID booking, String value, String capture) {
        String payments = capture == null ? "" : ",\"payments\":{\"captures\":[" + capture + "]}";
        return "{\"id\":\"" + ORDER + "\",\"status\":\"" + status + "\",\"purchase_units\":[{\"custom_id\":\""
                + booking + "\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\"" + value + "\"}" + payments
                + "}],\"links\":[{\"rel\":\"payer-action\",\"href\":\"" + APPROVE + "\"}]}";
    }

    static String refundedOrder(UUID booking, String refundId, String status) {
        return order("COMPLETED", booking, "10.00", capture("COMPLETED", "10.00")).replace("}]}}],\"links\"",
                "}],\"refunds\":[{\"id\":\"" + refundId + "\",\"status\":\"" + status + "\"}]}}],\"links\"");
    }

    static String capture(String status, String value) {
        return "{\"id\":\"CAPTURE1\",\"status\":\"" + status + "\",\"amount\":{\"currency_code\":\"EUR\",\"value\":\""
                + value + "\"}}";
    }

    static String refund(String status) {
        return "{\"id\":\"REFUND1\",\"status\":\"" + status + "\"}";
    }

    record Reply(int status, String body, Duration delay) {
    }

    record Seen(String route, Map<String, String> headers, String body) {

        String header(String name) {
            return headers.get(name.toLowerCase(java.util.Locale.ROOT));
        }

        JsonNode json() {
            return JSON.readTree(body);
        }
    }
}
