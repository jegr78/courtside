package org.courtside.config.internal;

final class AppShortName {

    static final int MAX_LENGTH = 12;

    private AppShortName() {
    }

    static boolean fits(String name) {
        return !name.isBlank() && length(name) <= MAX_LENGTH;
    }

    static String derivedFrom(String clubName) {
        String name = clubName.strip();
        if (length(name) <= MAX_LENGTH) {
            return name;
        }
        String fitted = "";
        for (String word : name.split("\\s+")) {
            String candidate = fitted.isEmpty() ? word : fitted + " " + word;
            if (length(candidate) > MAX_LENGTH) {
                break;
            }
            fitted = candidate;
        }
        return fitted.isEmpty() ? name.substring(0, name.offsetByCodePoints(0, MAX_LENGTH)) : fitted;
    }

    private static int length(String text) {
        return text.codePointCount(0, text.length());
    }
}
