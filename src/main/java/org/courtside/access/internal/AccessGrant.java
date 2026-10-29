package org.courtside.access.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "access_grant")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccessGrant {

    @Id
    private UUID id;

    @Column(nullable = false)
    private UUID bookingId;

    private Instant firstAcceptedAt;

    @Column(nullable = false)
    private boolean wanted;

    private Instant wantFrom;

    private Instant wantUntil;

    @Getter(AccessLevel.NONE)
    private UUID[] wantPoints;

    private String wantMapping;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RemoteState remote;

    private Instant remoteFrom;

    private Instant remoteUntil;

    @Getter(AccessLevel.NONE)
    private UUID[] remotePoints;

    private String remoteMapping;

    private Instant exposedUntil;

    private Instant lastInstallSentAt;

    private String externalReference;

    @Column(nullable = false)
    private int attempts;

    @Column(nullable = false)
    private int rejections;

    private Instant nextAttemptAt;

    private String lastFailure;

    @Column(nullable = false)
    private boolean refused;

    private Instant retryRequestedAt;

    public Set<UUID> getWantPoints() {
        return points(wantPoints);
    }

    public Set<UUID> getRemotePoints() {
        return points(remotePoints);
    }

    private static Set<UUID> points(UUID[] stored) {
        return stored == null ? Set.of() : Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(stored)));
    }
}
