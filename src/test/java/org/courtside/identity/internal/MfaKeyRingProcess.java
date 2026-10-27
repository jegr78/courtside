package org.courtside.identity.internal;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

public final class MfaKeyRingProcess {
    private MfaKeyRingProcess() { }

    public static void main(String[] arguments) throws Exception {
        Path file = Path.of(arguments[0]);
        Path ready = Path.of(arguments[1]);
        Path start = Path.of(arguments[2]);
        Path result = Path.of(arguments[3]);
        MfaKeyRing.open(file.resolveSibling("warmup.keys"), false);
        Files.writeString(ready, "ready");
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (!Files.exists(start)) {
            if (System.nanoTime() >= deadline) throw new IllegalStateException("Key initialization gate did not open");
            Thread.sleep(5);
        }
        Files.writeString(result, MfaKeyRing.open(file, false).activeKeyId());
    }
}
