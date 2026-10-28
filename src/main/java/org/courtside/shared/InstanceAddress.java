package org.courtside.shared;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public final class InstanceAddress {
    private static final Pattern AUTHORITY = Pattern.compile("(\\[[0-9A-Fa-f:.]+]|[^:@\\[\\]]+)(?::([0-9]{1,5}))?");
    // Browsers parse a host whose last label is numeric as IPv4, and refuse any IP as relying-party id.
    private static final Pattern IP_HOST = Pattern.compile("\\[.*]|(.*\\.)?(0x[0-9a-f]*|[0-9]+)\\.?");
    private final String origin;

    public InstanceAddress(@Value("${courtside.public-url:}") String configured) {
        origin = originOf(configured);
    }

    public Optional<URI> origin() {
        return origin.isEmpty() ? Optional.empty() : Optional.of(URI.create(origin));
    }

    public Optional<String> relyingPartyId() {
        return origin().map(URI::getHost).filter(host -> !IP_HOST.matcher(host).matches());
    }

    // The value never reaches the failure, because it may hold credentials.
    private static String originOf(String configured) {
        if (configured == null || configured.isBlank()) {
            return "";
        }
        String origin = asciiOrigin(configured.strip());
        if (origin == null) {
            throw new IllegalStateException("COURTSIDE_PUBLIC_URL must be the absolute https address of this"
                    + " instance without path, query or credentials, such as https://courts.example.org;"
                    + " Courtside will not start");
        }
        return origin;
    }

    private static String asciiOrigin(String configured) {
        try {
            URI address = new URI(configured);
            Matcher authority = address.getRawAuthority() == null ? null
                    : AUTHORITY.matcher(address.getRawAuthority());
            if (!"https".equalsIgnoreCase(address.getScheme()) || authority == null || !authority.matches()
                    || !(address.getRawPath().isEmpty() || address.getRawPath().equals("/"))
                    || address.getRawQuery() != null || address.getRawFragment() != null) {
                return null;
            }
            int port = authority.group(2) == null ? -1 : Integer.parseInt(authority.group(2));
            if (port == 0 || port > 65_535) {
                return null;
            }
            String host = (authority.group(1).startsWith("[") ? authority.group(1)
                    : IDN.toASCII(authority.group(1), IDN.USE_STD3_ASCII_RULES)).toLowerCase(Locale.ROOT);
            URI origin = new URI("https", null, host, port, null, null, null);
            return origin.getHost() == null ? null : origin.toString();
        } catch (URISyntaxException | IllegalArgumentException malformed) {
            return null;
        }
    }
}
