package org.courtside.access.internal;

import java.net.URI;

/** Where the Miniserver is reached: through the Loxone Cloud resolver by serial, or at a fixed HTTPS address. */
sealed interface LoxoneAddress {

    URI CLOUD_RESOLVER = URI.create("https://connect.loxonecloud.com");

    record Serial(String serial, URI resolver) implements LoxoneAddress {
    }

    record Fixed(URI url) implements LoxoneAddress {
    }
}
