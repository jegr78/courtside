package org.courtside.operations.internal;

import java.util.regex.Pattern;

final class OperationalLogRedactor {

    private static final Pattern URL_USER_INFO = Pattern.compile("(?i)((?:https?|wss?)://)[^\\s/?#@]+@");
    private static final Pattern URL = Pattern.compile("(?i)((?:https?|wss?)://[^\\s/?#]+)[^\\s]*");
    private static final Pattern AUTHORIZATION = Pattern.compile(
            "(?i)(\\bauthorization\\s*[:=]\\s*)(?:bearer\\s+)?[^\\s,;]+");
    private static final Pattern COOKIE = Pattern.compile(
            "(?i)(\\b(?:cookie|set-cookie)\\s*[:=]\\s*)[^\\r\\n]+");
    private static final Pattern REQUEST_BODY = Pattern.compile(
            "(?is)(\\b(?:request[_-]?body|body)\\s*[:=]\\s*).*$");
    private static final Pattern NAMED_SECRET = Pattern.compile(
            "(?i)(\\b(?:password|passwd|token|secret|csrf|session|credential|api[_-]?key)\\s*[:=]\\s*)[^\\s,;]+");
    private static final Pattern DIRECT_IDENTIFIER = Pattern.compile(
            "(?i)([\\\"'(]?(?:first[_-]?name|last[_-]?name|display[_-]?name|user(?:name)?|person|actor|subject|"
                    + "address|phone|mobile|member[_-]?(?:number|id)|birth[_-]?date)[\\\"')]*\\s*[:=]\\s*\\(?)"
                    + "(?:\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;})]+)");
    private static final Pattern IBAN = Pattern.compile("(?i)\\b[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]){11,30}\\b");
    private static final Pattern EMAIL = Pattern.compile(
            "(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b");
    private static final Pattern IPV4 = Pattern.compile(
            "(?<![A-Fa-f0-9:])(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}(?![A-Fa-f0-9:])");
    private static final Pattern IPV6 = Pattern.compile(
            "(?i)(?<![A-F0-9:])(?:[A-F0-9]{0,4}:){3,7}[A-F0-9]{0,4}(?![A-F0-9:])");
    private static final Pattern UUID = Pattern.compile(
            "(?i)\\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\\b");
    private static final Pattern OPAQUE = Pattern.compile("\\b[A-Za-z0-9_-]{24,}\\b");
    private static final Pattern W3C_TRACE_ID = Pattern.compile("[A-Fa-f0-9]{32}");

    private OperationalLogRedactor() {
    }

    static String redact(String value) {
        String redacted = URL_USER_INFO.matcher(value).replaceAll("$1");
        redacted = URL.matcher(redacted).replaceAll("$1/<redacted>");
        redacted = AUTHORIZATION.matcher(redacted).replaceAll("$1[REDACTED]");
        redacted = COOKIE.matcher(redacted).replaceAll("$1[REDACTED]");
        redacted = REQUEST_BODY.matcher(redacted).replaceAll("$1[REDACTED]");
        redacted = NAMED_SECRET.matcher(redacted).replaceAll("$1[REDACTED]");
        redacted = DIRECT_IDENTIFIER.matcher(redacted).replaceAll("$1[REDACTED]");
        redacted = IBAN.matcher(redacted).replaceAll("[REDACTED]");
        redacted = EMAIL.matcher(redacted).replaceAll("[REDACTED]");
        redacted = IPV4.matcher(redacted).replaceAll("[REDACTED]");
        redacted = IPV6.matcher(redacted).replaceAll("[REDACTED]");
        redacted = UUID.matcher(redacted).replaceAll("[REDACTED]");
        return OPAQUE.matcher(redacted).replaceAll("[REDACTED]");
    }

    static String safeTraceId(String value) {
        return W3C_TRACE_ID.matcher(value).matches() ? value.toLowerCase(java.util.Locale.ROOT) : null;
    }
}
