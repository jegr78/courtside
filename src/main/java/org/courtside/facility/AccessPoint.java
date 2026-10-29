package org.courtside.facility;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "access_point")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccessPoint {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(name = "static_code")
    private String staticCode;

    @Column(nullable = false)
    private boolean active;

    @Getter(AccessLevel.NONE)
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "access_point_court", joinColumns = @JoinColumn(name = "access_point_id"))
    @Column(name = "court_id", nullable = false)
    private Set<UUID> courtIds = new HashSet<>();

    public AccessPoint(String name, Set<UUID> courtIds, String staticCode) {
        this.id = UUID.randomUUID();
        changeTo(name, courtIds, staticCode);
        this.active = true;
    }

    public Set<UUID> getCourtIds() {
        return Set.copyOf(courtIds);
    }

    public boolean serves(UUID courtId) {
        return courtIds.contains(courtId);
    }

    public void changeTo(String name, Set<UUID> courtIds, String staticCode) {
        this.name = name;
        this.courtIds.clear();
        this.courtIds.addAll(courtIds);
        this.staticCode = staticCode;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
