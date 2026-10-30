package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;

import java.util.regex.Pattern;

/** Text a connector supplied, cleared of URL credentials and anything shaped like an access code before it is stored or logged. */
final class ConnectorText {

    private static final Pattern URL_CREDENTIALS = Pattern.compile(
            "\\b([a-z][a-z0-9+.-]*://)(?:[^\\s/@]*@)?([^\\s?#]*)(?:\\?[^\\s#]*)?", Pattern.CASE_INSENSITIVE);
    private static final Pattern CODE_SHAPED = Pattern.compile("(?<!\\d)\\d{4,8}(?!\\d)");

    private static final String MASK = "****";

    private ConnectorText() {
    }

    static String sanitized(@Nullable String text, @Nullable String code) {
        if (text == null) {
            return "";
        }
        String withoutCredentials = URL_CREDENTIALS.matcher(text).replaceAll("$1$2");
        String withoutCode = code == null || code.isEmpty()
                ? withoutCredentials : withoutCredentials.replace(code, MASK);
        return CODE_SHAPED.matcher(withoutCode).replaceAll(MASK);
    }
}
