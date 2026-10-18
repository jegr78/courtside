package org.courtside.member.internal;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
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
import org.courtside.member.GuardianGrant;
import org.courtside.member.GuardianRelationshipState;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "guardian_relationship")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GuardianRelationship {

    @Id
    private UUID id;

    @Column(name = "guardian_person_id", nullable = false)
    private UUID guardianPersonId;

    @Column(name = "dependant_person_id", nullable = false)
    private UUID dependantPersonId;

    @Column(name = "started_on", nullable = false)
    private LocalDate startedOn;

    @Column(name = "ended_on")
    private LocalDate endedOn;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "guardian_relationship_action",
            joinColumns = @JoinColumn(name = "guardian_relationship_id"))
    @Column(name = "action", nullable = false)
    @Enumerated(EnumType.STRING)
    private Set<GuardianGrant> grants;

    public GuardianRelationship(UUID guardianPersonId, UUID dependantPersonId, LocalDate startedOn,
                                Set<GuardianGrant> grants, LocalDate endedOn) {
        this.id = UUID.randomUUID();
        this.guardianPersonId = guardianPersonId;
        this.dependantPersonId = dependantPersonId;
        this.startedOn = startedOn;
        this.grants = EnumSet.copyOf(grants);
        this.endedOn = endedOn;
    }

    public void change(Set<GuardianGrant> grants, LocalDate endedOn) {
        this.grants.clear();
        this.grants.addAll(grants);
        this.endedOn = endedOn;
    }

    public void endOn(LocalDate day) {
        this.endedOn = day;
    }

    public boolean isValidOn(LocalDate day) {
        return !startedOn.isAfter(day) && (endedOn == null || endedOn.isAfter(day));
    }

    public boolean holdsAfter(LocalDate day) {
        return endedOn == null || endedOn.isAfter(day);
    }

    public GuardianRelationshipState stateOn(LocalDate day) {
        return isValidOn(day) ? GuardianRelationshipState.RUNNING : GuardianRelationshipState.ENDED;
    }
}
