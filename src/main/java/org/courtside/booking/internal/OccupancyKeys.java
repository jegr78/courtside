package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OccupancyKeys {

    private static final int KEY_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final OccupancyKeyRepository keys;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public record IssuedKey(String key, Instant createdAt) {
    }

    /** When the current key was created, or empty while no key exists. */
    public Optional<Instant> createdAt() {
        return keys.findById(OccupancyKey.THE_KEY).map(OccupancyKey::getCreatedAt);
    }

    /** Creates a new key, replacing any before it. The key is returned here and nowhere else. */
    @Transactional
    public IssuedKey issue() {
        byte[] random = new byte[KEY_BYTES];
        RANDOM.nextBytes(random);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        Instant now = clock.instant();
        keys.findById(OccupancyKey.THE_KEY).ifPresentOrElse(
                current -> current.replace(hash(key), now),
                () -> keys.save(new OccupancyKey(hash(key), now)));
        events.publishEvent(new OccupancyKeyEvent.Created());
        return new IssuedKey(key, now);
    }

    @Transactional
    public void revoke() {
        keys.findById(OccupancyKey.THE_KEY).ifPresent(current -> {
            keys.delete(current);
            events.publishEvent(new OccupancyKeyEvent.Revoked());
        });
    }

    public boolean accepts(String presented) {
        if (presented == null || presented.isEmpty()) {
            return false;
        }
        return keys.findById(OccupancyKey.THE_KEY)
                .filter(current -> MessageDigest.isEqual(
                        current.getKeyHash().getBytes(StandardCharsets.US_ASCII),
                        hash(presented).getBytes(StandardCharsets.US_ASCII)))
                .isPresent();
    }

    private static String hash(String key) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Every Java runtime provides SHA-256", e);
        }
    }
}
