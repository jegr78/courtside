package org.courtside.identity.internal;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.IntStream;

final class MfaRecoveryCodes {
    private MfaRecoveryCodes() { }

    static List<String> generate() {
        return IntStream.range(0, 10)
                .mapToObj(ignored -> ResetCodes.generate() + "-" + ResetCodes.generate() + "-" + ResetCodes.generate())
                .toList();
    }

    static Optional<String> verifier(String code) {
        if (code == null || code.length() > 128) return Optional.empty();
        String normalized = code.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
        if (!normalized.matches("[2-9A-HJKMNP-TV-Z]{24}")) return Optional.empty();
        return Optional.of(ResetCodes.fingerprint("MFA:" + normalized));
    }
}
