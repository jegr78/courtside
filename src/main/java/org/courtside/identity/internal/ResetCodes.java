package org.courtside.identity.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;

// The alphabet leaves out every glyph a member could read as another one, so retyping a code from a
// mail cannot fail on a choice between 0 and O or 1 and l.
final class ResetCodes {

    private static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final int CHARACTERS = 8;
    private static final int GROUP = 4;
    private static final SecureRandom RANDOM = new SecureRandom();

    private ResetCodes() {
    }

    static String generate() {
        StringBuilder code = new StringBuilder(CHARACTERS + 1);
        for (int drawn = 0; drawn < CHARACTERS; drawn++) {
            if (drawn == GROUP) {
                code.append('-');
            }
            code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    static String fingerprint(String code) {
        return sha256(normalized(code));
    }

    // What the code was mailed to, kept as a fingerprint so that correcting an address withdraws
    // the code that went to the old one without this table holding an address of its own.
    static String fingerprintOfAddress(String address) {
        return sha256(address.strip().toLowerCase(Locale.ROOT));
    }

    private static String normalized(String code) {
        return code.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("SHA-256 is unavailable", unavailable);
        }
    }
}
