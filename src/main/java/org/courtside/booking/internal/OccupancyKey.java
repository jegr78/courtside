package org.courtside.booking.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Entity
@Table(name = "occupancy_key")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class OccupancyKey {

    static final short THE_KEY = 1;

    @Id
    private short id;

    @Column(name = "key_hash", nullable = false)
    private String keyHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    OccupancyKey(String keyHash, Instant createdAt) {
        this.id = THE_KEY;
        this.keyHash = keyHash;
        this.createdAt = createdAt;
    }

    void replace(String keyHash, Instant createdAt) {
        this.keyHash = keyHash;
        this.createdAt = createdAt;
    }
}
