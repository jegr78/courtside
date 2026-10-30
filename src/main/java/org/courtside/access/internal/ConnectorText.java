package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;

import java.util.regex.Pattern;

/** Text a connector supplied, cleared of anything shaped like an access code before it is stored or logged. */
final class ConnectorText {

    private static final Pattern CODE_SHAPED = Pattern.compile("(?<!\\d)\\d{4,8}(?!\\d)");

    private ConnectorText() {
    }

    static String sanitized(@Nullable String text) {
        return text == null ? "" : CODE_SHAPED.matcher(text).replaceAll("****");
    }
}
