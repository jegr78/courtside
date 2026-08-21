package org.courtside.dataexchange;

import java.nio.charset.Charset;
import java.nio.charset.IllegalCharsetNameException;
import java.nio.charset.StandardCharsets;
import java.nio.charset.UnsupportedCharsetException;
import java.util.List;

public final class SupportedEncodings {

    private static final Charset DEFAULT = StandardCharsets.UTF_8;

    private SupportedEncodings() {
    }

    public static List<String> names() {
        return Charset.availableCharsets().values().stream().map(Charset::name).sorted().toList();
    }

    // An unusable name is a club naming a character set, not a caller with a bug, so it carries a code.
    public static Charset resolve(String name) {
        if (name == null || name.isBlank()) {
            return DEFAULT;
        }
        try {
            return Charset.forName(name.strip());
        } catch (IllegalCharsetNameException | UnsupportedCharsetException e) {
            throw new SnapshotEncodingUnsupportedException(name.strip());
        }
    }
}
