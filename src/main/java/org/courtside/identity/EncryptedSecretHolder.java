package org.courtside.identity;

import java.util.List;

/** A module that stores values encrypted with {@link InstanceSecrets}, which start-up and health verify. */
@FunctionalInterface
public interface EncryptedSecretHolder {

    List<StoredSecret> storedSecrets();

    record StoredSecret(String purpose, String encrypted) {
    }
}
