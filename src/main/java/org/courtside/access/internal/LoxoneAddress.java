package org.courtside.access.internal;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/** Where the Miniserver is reached: through the Loxone Cloud resolver by serial, or at a fixed HTTPS address. */
sealed interface LoxoneAddress {

    URI CLOUD_RESOLVER = URI.create("https://connect.loxonecloud.com");

    List<Relay> LOXONE_RELAYS = List.of(new Relay("remcov3.loxonecloud.com", 20_000, 49_000),
            new Relay("dyndns.loxonecloud.com", 1, 65_535));

    /** A domain the resolver may name, with the ports a relay address under it may use. */
    record Relay(String domain, int lowestPort, int highestPort) {
    }

    /** {@code userAgent} is sent with the address lookup only, empty for the HTTP client's own. */
    record Serial(String serial, URI resolver, List<Relay> relays, String userAgent) implements LoxoneAddress {

        Serial(String serial, URI resolver, List<Relay> relays) {
            this(serial, resolver, relays, "");
        }

        static Serial throughLoxoneCloud(String serial) {
            return throughLoxoneCloud(serial, "");
        }

        static Serial throughLoxoneCloud(String serial, String userAgent) {
            return new Serial(serial, CLOUD_RESOLVER, LOXONE_RELAYS, userAgent);
        }

        boolean admits(URI address) {
            String scheme = address.getScheme();
            String host = address.getHost();
            if (scheme == null || !scheme.equalsIgnoreCase("https") || host == null
                    || address.getRawUserInfo() != null) {
                return false;
            }
            String named = host.toLowerCase(Locale.ROOT);
            int port = address.getPort() == -1 ? 443 : address.getPort();
            return relays.stream().anyMatch(relay -> {
                String domain = relay.domain().toLowerCase(Locale.ROOT);
                return (named.equals(domain) || named.endsWith("." + domain))
                        && port >= relay.lowestPort() && port <= relay.highestPort();
            });
        }
    }

    record Fixed(URI url) implements LoxoneAddress {
    }
}
