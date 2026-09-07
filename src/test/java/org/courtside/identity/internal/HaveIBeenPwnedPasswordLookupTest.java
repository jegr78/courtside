package org.courtside.identity.internal;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HaveIBeenPwnedPasswordLookupTest {

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void givenARangeContainingThePasswordsSuffix_whenItIsChecked_thenOnlyThePrefixLeavesTheProcess()
            throws Exception {
        // given
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> padding = new AtomicReference<>();
        HaveIBeenPwnedPasswordLookup lookup = lookup((requestPath, addPadding) -> {
            path.set(requestPath);
            padding.set(addPadding);
            return "FE5CCB19BA61C4C0873D391E987982FBBD3:42\r\n"
                    + "00000000000000000000000000000000000:0\r\n";
        });

        // when
        boolean breached = lookup.isBreached("test");

        // then
        assertThat(breached).isTrue();
        assertThat(path.get()).isEqualTo("/range/A94A8");
        assertThat(path.get()).doesNotContain("FE5CCB19BA61C4C0873D391E987982FBBD3");
        assertThat(padding.get()).isEqualTo("true");
    }

    @Test
    void givenTwoPasswordsWithTheSamePrefix_whenTheyAreChecked_thenTheSuccessfulRangeIsFetchedOnce()
            throws Exception {
        // given
        List<String> requests = new ArrayList<>();
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) -> {
            requests.add(path);
            return "00000000000000000000000000000000000:0\r\n";
        });

        // when
        lookup.isBreached("test");
        lookup.isBreached("test");

        // then
        assertThat(requests).containsExactly("/range/A94A8");
    }

    @Test
    void givenACachedRangePastItsLifetime_whenItIsCheckedAgain_thenItIsRefetched() throws Exception {
        // given
        Instant first = Instant.parse("2026-09-07T12:00:00Z");
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenReturn(first, first.plus(Duration.ofHours(2)));
        List<String> requests = new ArrayList<>();
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) -> {
            requests.add(path);
            return "00000000000000000000000000000000000:0\r\n";
        }, clock, 10, Duration.ofHours(1));

        // when
        lookup.isBreached("test");
        lookup.isBreached("test");

        // then
        assertThat(requests).containsExactly("/range/A94A8", "/range/A94A8");
    }

    @Test
    void givenTheCacheIsFull_whenAnotherRangeArrives_thenTheLeastRecentlyUsedRangeIsEvicted()
            throws Exception {
        // given
        List<String> requests = new ArrayList<>();
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) -> {
            requests.add(path);
            return "00000000000000000000000000000000000:0\r\n";
        }, fixedClock(), 1, Duration.ofHours(1));

        // when
        lookup.isBreached("test");
        lookup.isBreached("another-password");
        lookup.isBreached("test");

        // then
        assertThat(requests).hasSize(3);
        assertThat(requests.get(0)).isEqualTo(requests.get(2)).isNotEqualTo(requests.get(1));
    }

    @Test
    void givenARangeRequestFails_whenTheSamePrefixIsRetried_thenTheFailureWasNotCached()
            throws Exception {
        // given
        AtomicInteger requests = new AtomicInteger();
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) ->
                requests.incrementAndGet() == 1
                        ? null : "00000000000000000000000000000000000:0\r\n");
        assertThatThrownBy(() -> lookup.isBreached("test"))
                .isInstanceOf(BreachedPasswordCheckUnavailableException.class);

        // when
        boolean breached = lookup.isBreached("test");

        // then
        assertThat(breached).isFalse();
        assertThat(requests).hasValue(2);
    }

    @Test
    void givenTheRangeServiceRefusesTheRequest_whenAPasswordIsChecked_thenTheOperationFailsClosed()
            throws Exception {
        // given
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) -> null);

        // when / then
        assertThatThrownBy(() -> lookup.isBreached("test"))
                .isInstanceOf(BreachedPasswordCheckUnavailableException.class);
    }

    @Test
    void givenAMalformedRange_whenAPasswordIsChecked_thenTheOperationFailsClosed() throws Exception {
        // given
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) -> "not-a-range\r\n");

        // when / then
        assertThatThrownBy(() -> lookup.isBreached("test"))
                .isInstanceOf(BreachedPasswordCheckUnavailableException.class);
    }

    @Test
    void givenAnOversizedRange_whenAPasswordIsChecked_thenTheOperationFailsClosed() throws Exception {
        // given
        HaveIBeenPwnedPasswordLookup lookup = lookup((path, padding) ->
                "00000000000000000000000000000000000:1\r\n".repeat(7_000));

        // when / then
        assertThatThrownBy(() -> lookup.isBreached("test"))
                .isInstanceOf(BreachedPasswordCheckUnavailableException.class);
    }

    @Test
    @Timeout(value = 2, unit = TimeUnit.SECONDS)
    void givenARangeThatStallsAfterItsHeaders_whenAPasswordIsChecked_thenTheRequestDeadlineStillApplies()
            throws Exception {
        // given
        CountDownLatch releaseBody = new CountDownLatch(1);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/range", exchange -> {
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write('0');
            exchange.getResponseBody().flush();
            try {
                releaseBody.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally {
                exchange.close();
            }
        });
        server.start();
        HaveIBeenPwnedPasswordLookup lookup = new HaveIBeenPwnedPasswordLookup(
                URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/range/"),
                Duration.ofMillis(100), 10, Duration.ofHours(1),
                Clock.fixed(Instant.parse("2026-09-07T12:00:00Z"), ZoneOffset.UTC));

        // when / then
        try {
            assertThatThrownBy(() -> lookup.isBreached("test"))
                    .isInstanceOf(BreachedPasswordCheckUnavailableException.class);
        } finally {
            releaseBody.countDown();
        }
    }

    private HaveIBeenPwnedPasswordLookup lookup(Response response) throws IOException {
        return lookup(response, fixedClock(), 10, Duration.ofHours(1));
    }

    private HaveIBeenPwnedPasswordLookup lookup(Response response, Clock clock, int cacheEntries,
                                                 Duration cacheLifetime) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/range", exchange -> {
            String body = response.body(exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("Add-Padding"));
            if (body == null) {
                exchange.sendResponseHeaders(503, -1);
            } else {
                byte[] bytes = body.getBytes(StandardCharsets.US_ASCII);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
            }
            exchange.close();
        });
        server.start();
        return new HaveIBeenPwnedPasswordLookup(
                URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/range/"),
                Duration.ofSeconds(1), cacheEntries, cacheLifetime, clock);
    }

    private static Clock fixedClock() {
        return Clock.fixed(Instant.parse("2026-09-07T12:00:00Z"), ZoneOffset.UTC);
    }

    @FunctionalInterface
    private interface Response {
        String body(String path, String addPadding);
    }
}
