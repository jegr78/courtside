package org.courtside.identity;

/** Encrypts a value with the instance key ring, bound to the purpose it is stored for. */
public interface InstanceSecrets {

    String encrypt(String purpose, byte[] value);

    byte[] decrypt(String purpose, String encrypted);
}
