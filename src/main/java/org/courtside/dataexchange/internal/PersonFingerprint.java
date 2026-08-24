package org.courtside.dataexchange.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import java.util.stream.Stream;

public final class PersonFingerprint {

    private PersonFingerprint() {
    }

    // Every field carries its own length, so no arrangement of two fields hashes like another.
    public static String of(String firstName, String lastName, String email, UUID membershipTypeId,
                            boolean membershipCurrent, boolean holdsAnAccount) {
        StringBuilder joined = new StringBuilder();
        Stream.of(nullSafe(firstName), nullSafe(lastName), nullSafe(email),
                        String.valueOf(membershipTypeId), String.valueOf(membershipCurrent),
                        String.valueOf(holdsAnAccount))
                .forEach(field -> joined.append(field.length()).append(':').append(field));
        return sha256(joined.toString());
    }

    public static String sha256(String value) {
        return HexFormat.of().formatHex(digest().digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    public static String sha256(byte[] value) {
        return HexFormat.of().formatHex(digest().digest(value));
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every Java platform", e);
        }
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }
}
