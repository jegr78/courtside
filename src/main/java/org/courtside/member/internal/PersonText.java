package org.courtside.member.internal;

public final class PersonText {

    private PersonText() {
    }

    public static String stripped(String value) {
        if (value == null) {
            return null;
        }
        int start = 0;
        int end = value.length();
        while (start < end && isPadding(value.codePointAt(start))) {
            start += Character.charCount(value.codePointAt(start));
        }
        while (end > start && isPadding(value.codePointBefore(end))) {
            end -= Character.charCount(value.codePointBefore(end));
        }
        return value.substring(start, end);
    }

    // Exactly the code points PersonRequest's pattern refuses a value made only of; PersonTextTest
    // holds the two together over every code point.
    private static boolean isPadding(int codePoint) {
        return codePoint >= 0x0009 && codePoint <= 0x000d
                || codePoint >= 0x001c && codePoint <= 0x0020
                || codePoint == 0x0085
                || codePoint == 0x00a0
                || codePoint == 0x1680
                || codePoint >= 0x2000 && codePoint <= 0x200a
                || codePoint == 0x2028
                || codePoint == 0x2029
                || codePoint == 0x202f
                || codePoint == 0x205f
                || codePoint == 0x3000
                || codePoint == 0xfeff;
    }
}
