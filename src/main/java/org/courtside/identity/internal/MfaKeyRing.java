package org.courtside.identity.internal;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

final class MfaKeyRing {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final Set<PosixFilePermission> OWNER_ONLY = PosixFilePermissions.fromString("rw-------");
    private final Path file;
    private volatile State state;

    private MfaKeyRing(Path file, State state) {
        this.file = file;
        this.state = state;
    }

    static MfaKeyRing open(Path file, boolean required) {
        Path location = file.toAbsolutePath().normalize();
        return locked(location, () -> {
            if (!Files.exists(location, LinkOption.NOFOLLOW_LINKS)) {
                if (required) throw failure("MFA instance key file is missing; restore the matching key material", null);
                write(location, fresh(Map.of()));
            }
            return new MfaKeyRing(location, read(location));
        });
    }

    String encrypt(UUID account, byte[] value) {
        State current = state;
        byte[] nonce = new byte[12];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, current.keys().get(current.active()), nonce, account);
            return current.active() + "." + ENCODER.encodeToString(nonce) + "."
                    + ENCODER.encodeToString(cipher.doFinal(value));
        } catch (GeneralSecurityException exception) {
            throw failure("MFA encryption could not use the instance key", exception);
        }
    }

    byte[] decrypt(UUID account, String value) {
        try {
            String[] pieces = value.split("\\.", -1);
            if (pieces.length != 3) throw failure("Invalid encrypted MFA data", null);
            SecretKey key = state.keys().get(pieces[0]);
            if (key == null) throw failure("Encrypted MFA data requires an unavailable instance key", null);
            byte[] nonce = DECODER.decode(pieces[1]);
            if (nonce.length != 12) throw failure("Invalid encrypted MFA nonce", null);
            return cipher(Cipher.DECRYPT_MODE, key, nonce, account).doFinal(DECODER.decode(pieces[2]));
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw failure("Encrypted MFA data does not match its account and instance key", exception);
        }
    }

    String activeKeyId() {
        return state.active();
    }

    void rotate() {
        locked(file, () -> {
            State next = fresh(read(file).keys());
            write(file, next);
            state = next;
            return null;
        });
    }

    private static Cipher cipher(int mode, SecretKey key, byte[] nonce, UUID account)
            throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(("courtside-mfa:" + account).getBytes(StandardCharsets.US_ASCII));
        return cipher;
    }

    private static State fresh(Map<String, SecretKey> existing) {
        Map<String, SecretKey> keys = new LinkedHashMap<>(existing);
        byte[] material = new byte[32];
        RANDOM.nextBytes(material);
        String id = UUID.randomUUID().toString();
        keys.put(id, new SecretKeySpec(material, "AES"));
        Arrays.fill(material, (byte) 0);
        return new State(id, Map.copyOf(keys));
    }

    private static State read(Path file) throws IOException {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > 65_536
                || !OWNER_ONLY.containsAll(Files.getPosixFilePermissions(file))) {
            throw failure("MFA key material must be a private regular file", null);
        }
        Properties stored = new Properties();
        try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            stored.load(input);
            if (!"1".equals(stored.getProperty("format"))) throw failure("Unsupported MFA key file format", null);
            String active = UUID.fromString(stored.getProperty("active", "")).toString();
            Map<String, SecretKey> keys = new LinkedHashMap<>();
            for (String name : stored.stringPropertyNames()) {
                if (Set.of("active", "format").contains(name)) continue;
                if (!name.startsWith("key.")) throw failure("Unexpected MFA key file entry", null);
                String id = UUID.fromString(name.substring(4)).toString();
                byte[] material = DECODER.decode(stored.getProperty(name));
                if (material.length != 32) throw failure("MFA instance keys must contain 256 bits", null);
                keys.put(id, new SecretKeySpec(material, "AES"));
                Arrays.fill(material, (byte) 0);
            }
            if (!keys.containsKey(active)) throw failure("The active MFA instance key is missing", null);
            return new State(active, Map.copyOf(keys));
        } catch (IllegalArgumentException exception) {
            throw failure("Invalid MFA key file", null);
        }
    }

    private static void write(Path file, State value) throws IOException {
        Properties stored = new Properties();
        stored.setProperty("format", "1");
        stored.setProperty("active", value.active());
        value.keys().forEach((id, key) -> stored.setProperty("key." + id, ENCODER.encodeToString(key.getEncoded())));
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        stored.store(bytes, null);
        Path temporary = Files.createTempFile(file.getParent(), ".mfa-", ".keys",
                PosixFilePermissions.asFileAttribute(OWNER_ONLY));
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes.toByteArray());
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            try (FileChannel directory = FileChannel.open(file.getParent(), StandardOpenOption.READ)) {
                directory.force(true);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static synchronized <T> T locked(Path file, DiskOperation<T> operation) {
        try {
            Files.createDirectories(file.getParent(), PosixFilePermissions.asFileAttribute(
                    PosixFilePermissions.fromString("rwx------")));
            Path lock = file.resolveSibling(file.getFileName() + ".lock");
            try (FileChannel channel = FileChannel.open(lock,
                    Set.of(StandardOpenOption.CREATE, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS),
                    PosixFilePermissions.asFileAttribute(OWNER_ONLY));
                 var held = channel.lock()) {
                return operation.run();
            }
        } catch (IOException exception) {
            throw failure("MFA instance key material cannot be read or persisted", exception);
        }
    }

    private static IllegalStateException failure(String message, Exception cause) {
        return new IllegalStateException(message, cause);
    }

    private record State(String active, Map<String, SecretKey> keys) { }

    private interface DiskOperation<T> {
        T run() throws IOException;
    }
}
