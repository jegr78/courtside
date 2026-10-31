package org.courtside.access.internal;

import java.net.URI;
import java.util.List;

/** Where the Miniserver is reached: through the Loxone Cloud resolver by serial, or at a fixed HTTPS address. */
sealed interface LoxoneAddress {

    URI CLOUD_RESOLVER = URI.create("https://connect.loxonecloud.com");

    List<Relay> LOXONE_RELAYS = List.of(new Relay("remcov3.loxonecloud.com", 20_000, 49_000),
            new Relay("dyndns.loxonecloud.com", 1, 65_535));

    /** A domain the resolver may name, with the ports a relay address under it may use. */
    record Relay(String domain, int lowestPort, int highestPort) {
    }

    record Serial(String serial, URI resolver, List<Relay> relays) implements LoxoneAddress {

        static Serial throughLoxoneCloud(String serial) {
            return new Serial(serial, CLOUD_RESOLVER, LOXONE_RELAYS);
        }

        boolean admits(URI address) {
            return true;
        }
    }

    record Fixed(URI url) implements LoxoneAddress {
    }
}
