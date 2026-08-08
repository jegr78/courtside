package org.courtside.card;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Entity
@Table(name = "booking_card")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingCard {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String label;

    @Column(nullable = false)
    private String color;

    @Column(name = "required_role")
    private String requiredRole;

    @Getter(AccessLevel.NONE)
    @Column(name = "allowed_player_counts", nullable = false)
    private short[] allowedPlayerCounts;

    @Column(name = "counts_against_limits", nullable = false)
    private boolean countsAgainstLimits;

    @Column(name = "guest_allowed", nullable = false)
    private boolean guestAllowed;

    @Column(nullable = false)
    private boolean active;

    public short[] getAllowedPlayerCounts() {
        return allowedPlayerCounts.clone();
    }

    public boolean tracksPlayers() {
        return allowedPlayerCounts.length > 0;
    }

    public boolean allows(int slotCount) {
        for (short allowed : allowedPlayerCounts) {
            if (allowed == slotCount) {
                return true;
            }
        }
        return false;
    }

    public BookingCard(String label, String color, String requiredRole,
                       short[] allowedPlayerCounts, boolean countsAgainstLimits,
                       boolean guestAllowed) {
        this.id = UUID.randomUUID();
        this.label = label;
        this.color = color;
        this.requiredRole = requiredRole;
        this.allowedPlayerCounts = allowedPlayerCounts.clone();
        this.countsAgainstLimits = countsAgainstLimits;
        this.guestAllowed = guestAllowed;
        this.active = true;
    }

    public void changeTo(String label, String color, String requiredRole,
                         short[] allowedPlayerCounts, boolean countsAgainstLimits,
                         boolean guestAllowed) {
        this.label = label;
        this.color = color;
        this.requiredRole = requiredRole;
        this.allowedPlayerCounts = allowedPlayerCounts.clone();
        this.countsAgainstLimits = countsAgainstLimits;
        this.guestAllowed = guestAllowed;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
