package org.courtside;

import java.net.http.HttpHeaders;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

public final class ApplicationResponseHeaders {

    public static final Map<String, String> SECURITY = Map.of(
            "content-security-policy", "default-src 'self'; object-src 'none'; img-src 'self' https:; "
                    + "style-src 'self'; script-src 'self'; connect-src 'self'; "
                    + "manifest-src 'self'; worker-src 'self'; "
                    + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            "x-content-type-options", "nosniff",
            "x-frame-options", "DENY",
            "referrer-policy", "strict-origin-when-cross-origin");

    public static final Map<String, String> UNCACHED = Map.of(
            "cache-control", "no-cache, no-store, max-age=0, must-revalidate",
            "pragma", "no-cache",
            "expires", "0");

    // These describe the transfer and its moment, and a HEAD answer has no body to transfer.
    private static final List<String> NOT_COMPARED = List.of("connection", "date", "transfer-encoding");

    private ApplicationResponseHeaders() {
    }

    public static Map<String, String> comparable(HttpHeaders headers) {
        Map<String, String> comparable = new TreeMap<>();
        headers.map().forEach((name, values) -> comparable.put(name.toLowerCase(Locale.ROOT),
                String.join(" | ", values)));
        NOT_COMPARED.forEach(comparable::remove);
        return comparable;
    }
}
