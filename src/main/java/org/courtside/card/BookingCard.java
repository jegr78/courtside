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
import java.util.stream.Collectors;

@Entity
@Table(name = "booking_card")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingCard {

    public static final UUID COURT_CLOSED = UUID.fromString("44444444-4444-4444-4444-444444444444");

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
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "booking_card_managing_role", joinColumns = @JoinColumn(name = "booking_card_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private Set<Role> managingRoles = new HashSet<>();

    @Getter(AccessLevel.NONE)
    @Column(name = "allowed_player_counts", nullable = false)
    private short[] allowedPlayerCounts;

    @Column(name = "counts_against_limits", nullable = false)
    private boolean countsAgainstLimits;

    @Column(name = "show_generic_occupancy", nullable = false)
    private boolean showGenericOccupancy;

    @Column(name = "guest_allowed", nullable = false)
    private boolean guestAllowed;

    @Column(name = "grants_access", nullable = false)
    private boolean grantsAccess;

    @Column(name = "signals_occupancy", nullable = false)
    private boolean signalsOccupancy;

    @Column(name = "holds_doors_open", nullable = false)
    private boolean holdsDoorsOpen;

    @Column(name = "guest_fee_minor", nullable = false)
    private int guestFeeMinor;

    @Column(name = "external_price_minor", nullable = false)
    private int externalPriceMinor;

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

    // EXTERNAL opens a card only while the club admits external bookings, whatever else the card names.
    public boolean permits(Set<Role> callerRoles, boolean currentMember, boolean externalBookingsAdmitted) {
        return allowedRoles.isEmpty() ? currentMember : callerRoles.stream()
                .filter(role -> role != Role.EXTERNAL || externalBookingsAdmitted)
                .anyMatch(allowedRoles::contains);
    }

    public boolean requiresMembership() {
        return allowedRoles.isEmpty();
    }

    public Set<Role> getAllowedRoles() {
        return Set.copyOf(allowedRoles);
    }

    public static Set<Role> managementRoles(Set<Role> roles) {
        return roles.stream()
                .filter(role -> role != Role.MEMBER && role != Role.EXTERNAL)
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean permitsManagement(Set<Role> callerRoles) {
        return !managingRoles.isEmpty() && callerRoles.stream().anyMatch(managingRoles::contains);
    }

    public Set<Role> getManagingRoles() {
        return Set.copyOf(managingRoles);
    }

    public BookingCard(String label, String color, Set<Role> allowedRoles, Set<Role> managingRoles,
                       short[] allowedPlayerCounts, boolean countsAgainstLimits,
                       boolean guestAllowed, boolean showGenericOccupancy, boolean grantsAccess,
                       boolean signalsOccupancy) {
        this.id = UUID.randomUUID();
        this.label = label;
        this.color = color;
        this.allowedRoles = new HashSet<>(allowedRoles);
        this.managingRoles = new HashSet<>(managingRoles);
        this.allowedPlayerCounts = allowedPlayerCounts.clone();
        this.countsAgainstLimits = countsAgainstLimits;
        this.guestAllowed = guestAllowed;
        this.showGenericOccupancy = showGenericOccupancy;
        this.grantsAccess = grantsAccess;
        this.signalsOccupancy = signalsOccupancy;
        this.active = true;
    }

    public void chargeGuests(int guestFeeMinor) {
        if (guestFeeMinor < 0) {
            throw new IllegalStateException("A guest fee is never negative; the request validation was skipped");
        }
        this.guestFeeMinor = guestFeeMinor;
    }

    public void priceForExternals(int externalPriceMinor) {
        if (externalPriceMinor < 0) {
            throw new IllegalStateException("An external price is never negative; the request validation was skipped");
        }
        this.externalPriceMinor = externalPriceMinor;
    }

    public void changeTo(String label, String color, Set<Role> allowedRoles, Set<Role> managingRoles,
                         short[] allowedPlayerCounts, boolean countsAgainstLimits,
                         boolean guestAllowed, boolean showGenericOccupancy, boolean grantsAccess,
                         boolean signalsOccupancy) {
        this.label = label;
        this.color = color;
        this.allowedRoles.clear();
        this.allowedRoles.addAll(allowedRoles);
        this.managingRoles.clear();
        this.managingRoles.addAll(managingRoles);
        this.allowedPlayerCounts = allowedPlayerCounts.clone();
        this.countsAgainstLimits = countsAgainstLimits;
        this.guestAllowed = guestAllowed;
        this.showGenericOccupancy = showGenericOccupancy;
        this.grantsAccess = grantsAccess;
        this.signalsOccupancy = signalsOccupancy;
    }

    public void holdDoorsOpen(boolean holdsDoorsOpen) {
        if (holdsDoorsOpen && COURT_CLOSED.equals(id)) {
            throw new IllegalStateException("The closure card never holds doors open; the service guard was skipped");
        }
        this.holdsDoorsOpen = holdsDoorsOpen;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
