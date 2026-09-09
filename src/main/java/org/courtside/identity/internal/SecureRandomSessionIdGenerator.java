package org.courtside.identity.internal;

import org.springframework.session.SessionIdGenerator;

import java.security.SecureRandom;
import java.util.Base64;

class SecureRandomSessionIdGenerator implements SessionIdGenerator {

    // 27 bytes encode to exactly 36 unpadded base64url characters, the width of spring_session.session_id.
    static final int IDENTIFIER_BYTES = 27;

    private final SecureRandom random = new SecureRandom();
    private final Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();

    @Override
    public String generate() {
        byte[] material = new byte[IDENTIFIER_BYTES];
        random.nextBytes(material);
        return encoder.encodeToString(material);
    }
}
