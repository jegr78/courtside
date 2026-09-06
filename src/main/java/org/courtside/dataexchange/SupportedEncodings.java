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

    // Some of the names above decode only — they exist to read a file whose encoding is unknown —
    // and asking one of them to write throws where a caller cannot see it coming.
    public static Charset forWriting(String name) {
        Charset charset = resolve(name);
        if (!charset.canEncode()) {
            throw new SnapshotEncodingUnsupportedException(name == null ? "" : name.strip());
        }
        return charset;
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
