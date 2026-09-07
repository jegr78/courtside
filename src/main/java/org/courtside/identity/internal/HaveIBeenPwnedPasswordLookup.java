package org.courtside.identity.internal;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

final class HaveIBeenPwnedPasswordLookup implements BreachedPasswordLookup {

    private static final Pattern RANGE_LINE = Pattern.compile("[A-F0-9]{35}:[0-9]+");
    private static final int MAXIMUM_RESPONSE_BYTES = 256 * 1024;

    private final URI rangeEndpoint;
    private final Duration requestTimeout;
    private final int cacheEntries;
    private final Duration cacheLifetime;
    private final Clock clock;
    private final HttpClient client;
    private final Map<String, CachedRange> cache;

    HaveIBeenPwnedPasswordLookup(URI rangeEndpoint, Duration requestTimeout, int cacheEntries,
                                 Duration cacheLifetime, Clock clock) {
        this.rangeEndpoint = rangeEndpoint;
        this.requestTimeout = requestTimeout;
        this.cacheEntries = cacheEntries;
        this.cacheLifetime = cacheLifetime;
        this.clock = clock;
        this.client = HttpClient.newBuilder().connectTimeout(requestTimeout).build();
        this.cache = new LinkedHashMap<>(16, 0.75f, true);
    }

    @Override
    public boolean isBreached(String password) {
        String hash = sha1(password);
        String prefix = hash.substring(0, 5);
        String suffix = hash.substring(5);
        return suffixes(prefix).contains(suffix);
    }

    private Set<String> suffixes(String prefix) {
        Instant now = clock.instant();
        synchronized (cache) {
            CachedRange cached = cache.get(prefix);
            if (cached != null && now.isBefore(cached.expiresAt())) {
                return cached.suffixes();
            }
            cache.remove(prefix);
        }
        Set<String> fetched = fetch(prefix);
        synchronized (cache) {
            cache.put(prefix, new CachedRange(fetched, now.plus(cacheLifetime)));
            while (cache.size() > cacheEntries) {
                cache.remove(cache.keySet().iterator().next());
            }
        }
        return fetched;
    }

    private Set<String> fetch(String prefix) {
        HttpRequest request = HttpRequest.newBuilder(rangeEndpoint.resolve(prefix))
                .timeout(requestTimeout)
                .header("Add-Padding", "true")
                .header("User-Agent", "Courtside password policy")
                .GET()
                .build();
        CompletableFuture<HttpResponse<byte[]>> exchange = client.sendAsync(request,
                HttpResponse.BodyHandlers.limiting(
                        HttpResponse.BodyHandlers.ofByteArray(), MAXIMUM_RESPONSE_BYTES));
        try {
            HttpResponse<byte[]> response = exchange.get(
                    requestTimeout.toNanos(), TimeUnit.NANOSECONDS);
            if (response.statusCode() != 200) {
                throw new BreachedPasswordCheckUnavailableException();
            }
            return parsed(response.body());
        } catch (InterruptedException interrupted) {
            exchange.cancel(true);
            Thread.currentThread().interrupt();
            throw new BreachedPasswordCheckUnavailableException(interrupted);
        } catch (TimeoutException timeout) {
            exchange.cancel(true);
            throw new BreachedPasswordCheckUnavailableException(timeout);
        } catch (ExecutionException failure) {
            throw new BreachedPasswordCheckUnavailableException(failure);
        }
    }

    private static Set<String> parsed(byte[] response) {
        String body = new String(response, StandardCharsets.US_ASCII);
        if (!StandardCharsets.US_ASCII.newEncoder().canEncode(body)) {
            throw new BreachedPasswordCheckUnavailableException();
        }
        Set<String> suffixes = Arrays.stream(body.split("\\r?\\n"))
                .filter(line -> !line.isEmpty())
                .map(line -> line.toUpperCase(Locale.ROOT))
                .peek(line -> {
                    if (!RANGE_LINE.matcher(line).matches()) {
                        throw new BreachedPasswordCheckUnavailableException();
                    }
                })
                .filter(line -> !line.endsWith(":0"))
                .map(line -> line.substring(0, 35))
                .collect(Collectors.toUnmodifiableSet());
        if (body.isBlank()) {
            throw new BreachedPasswordCheckUnavailableException();
        }
        return suffixes;
    }

    @SuppressWarnings("java:S4790")
    private static String sha1(String password) {
        try {
            // SHA-1 is mandated by the HIBP range protocol and carries no security guarantee here.
            // codeql[java/potentially-weak-cryptographic-algorithm]
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            return HexFormat.of().withUpperCase().formatHex(
                    digest.digest(password.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("The HIBP protocol digest is unavailable", unavailable);
        }
    }

    private record CachedRange(Set<String> suffixes, Instant expiresAt) {
    }
}
