package org.courtside.access.internal;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

/** The Miniserver's token login hash and the client uuid this instance requests its tokens under. */
final class LoxoneLogin {

    private LoxoneLogin() {
    }

    static String hash(String user, String password, String key, String salt, String hashAlgorithm) {
        String algorithm = hashAlgorithm.strip().toUpperCase(Locale.ROOT);
        if (!algorithm.equals("SHA1") && !algorithm.equals("SHA256")) {
            throw new LoxoneFailure("getkey2 named a hash algorithm the connector does not know");
        }
        byte[] secret;
        try {
            secret = HexFormat.of().parseHex(key);
        } catch (IllegalArgumentException malformed) {
            throw new LoxoneFailure("getkey2 answered a key that is not hex");
        }
        try {
            String digestName = algorithm.equals("SHA1") ? "SHA-1" : "SHA-256";
            String macName = algorithm.equals("SHA1") ? "HmacSHA1" : "HmacSHA256";
            // SHA-1 is what older Miniservers name in getkey2; the protocol, not this code, chooses it.
            // codeql[java/potentially-weak-cryptographic-algorithm]
            MessageDigest digest = MessageDigest.getInstance(digestName);
            String passwordHash = HexFormat.of().withUpperCase().formatHex(
                    digest.digest((password + ":" + salt).getBytes(StandardCharsets.UTF_8)));
            Mac mac = Mac.getInstance(macName);
            mac.init(new SecretKeySpec(secret, macName));
            return HexFormat.of().formatHex(mac.doFinal((user + ":" + passwordHash).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException unavailable) {
            throw new LoxoneFailure("the login hash algorithm is unavailable");
        }
    }

    static String clientUuid(LoxoneAddress address) {
        String identity = switch (address) {
            case LoxoneAddress.Serial(String serial, var resolver, var relays) -> "serial:" + serial.toUpperCase(Locale.ROOT);
            case LoxoneAddress.Fixed(var url) -> "url:" + url;
        };
        String hex = UUID.nameUUIDFromBytes(("courtside:" + identity).getBytes(StandardCharsets.UTF_8)).toString()
                .replace("-", "");
        return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" + hex.substring(16);
    }
}
