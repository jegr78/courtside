package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.InstanceSecrets;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class InstanceSecretStore implements InstanceSecrets {

    private final MfaSecrets secrets;

    @Override
    public String encrypt(String purpose, byte[] value) {
        return secrets.encrypt(purpose, value);
    }

    @Override
    public byte[] decrypt(String purpose, String encrypted) {
        return secrets.decrypt(purpose, encrypted);
    }
}
