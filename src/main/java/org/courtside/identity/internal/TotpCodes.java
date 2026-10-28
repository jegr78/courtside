package org.courtside.identity.internal;

import org.bouncycastle.util.encoders.Base32;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Locale;
import java.util.OptionalLong;

final class TotpCodes {
    private static final SecureRandom RANDOM = new SecureRandom();

    private TotpCodes() { }

    static byte[] newSecret() {
        byte[] secret = new byte[20];
        RANDOM.nextBytes(secret);
        return secret;
    }

    static String encodeSecret(byte[] secret) {
        requireSecret(secret);
        return Base32.toBase32String(secret);
    }

    static String code(byte[] secret, Instant now) {
        if (now == null || now.getEpochSecond() < 0) throw new IllegalStateException("Invalid TOTP clock");
        return atStep(secret, now.getEpochSecond() / 30);
    }

    static OptionalLong match(byte[] secret, String code, Instant now, long consumed) {
        if (code == null || !code.matches("[0-9]{6}") || now == null || now.getEpochSecond() < 0) {
            return OptionalLong.empty();
        }
        long current = now.getEpochSecond() / 30;
        long matched = -1;
        for (long step = Math.max(0, current - 1); step <= current + 1; step++) {
            if (step > consumed && MessageDigest.isEqual(
                    atStep(secret, step).getBytes(StandardCharsets.US_ASCII), code.getBytes(StandardCharsets.US_ASCII))) {
                matched = step;
            }
        }
        return matched < 0 ? OptionalLong.empty() : OptionalLong.of(matched);
    }

    private static String atStep(byte[] secret, long step) {
        requireSecret(secret);
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secret, "HmacSHA1"));
            byte[] digest = mac.doFinal(ByteBuffer.allocate(Long.BYTES).putLong(step).array());
            int offset = digest[digest.length - 1] & 0x0f;
            int truncated = ByteBuffer.wrap(digest, offset, Integer.BYTES).getInt() & 0x7fffffff;
            return String.format(Locale.ROOT, "%06d", truncated % 1_000_000);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("The TOTP cryptographic provider is unavailable", failure);
        }
    }

    private static void requireSecret(byte[] secret) {
        if (secret == null || secret.length != 20) throw new IllegalStateException("Invalid TOTP secret material");
    }
}
