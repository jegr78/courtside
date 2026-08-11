package org.courtside.card;

import jakarta.persistence.Column;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.identity.Role;

import java.util.HashSet;
import java.util.Set;
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

    @Getter(AccessLevel.NONE)
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "booking_card_allowed_role", joinColumns = @JoinColumn(name = "booking_card_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private Set<Role> allowedRoles = new HashSet<>();

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

    public boolean permits(Set<Role> callerRoles) {
        return allowedRoles.isEmpty() || callerRoles.stream().anyMatch(allowedRoles::contains);
    }

    public Set<Role> getAllowedRoles() {
        return Set.copyOf(allowedRoles);
    }

    public BookingCard(String label, String color, Set<Role> allowedRoles,
                       short[] allowedPlayerCounts, boolean countsAgainstLimits,
                       boolean guestAllowed) {
        this.id = UUID.randomUUID();
        this.label = label;
        this.color = color;
        this.allowedRoles = new HashSet<>(allowedRoles);
        this.allowedPlayerCounts = allowedPlayerCounts.clone();
        this.countsAgainstLimits = countsAgainstLimits;
        this.guestAllowed = guestAllowed;
        this.active = true;
    }

    public void changeTo(String label, String color, Set<Role> allowedRoles,
                         short[] allowedPlayerCounts, boolean countsAgainstLimits,
                         boolean guestAllowed) {
        this.label = label;
        this.color = color;
        this.allowedRoles.clear();
        this.allowedRoles.addAll(allowedRoles);
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
