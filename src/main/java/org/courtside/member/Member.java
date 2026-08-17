package org.courtside.member;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "member")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Member {

    @Id
    private UUID id;

    @Column(name = "person_id", nullable = false)
    private UUID personId;

    @Column(name = "membership_type_id", nullable = false)
    private UUID membershipTypeId;

    @Column(name = "started_on", nullable = false)
    private LocalDate startedOn;

    @Column(name = "ended_on")
    private LocalDate endedOn;

    public Member(UUID personId, UUID membershipTypeId, LocalDate startedOn) {
        this.id = UUID.randomUUID();
        this.personId = personId;
        this.membershipTypeId = membershipTypeId;
        this.startedOn = startedOn;
    }

    public void assignTo(UUID membershipTypeId) {
        this.membershipTypeId = membershipTypeId;
    }

    public void reviveOn(UUID membershipTypeId, LocalDate startedOn) {
        this.membershipTypeId = membershipTypeId;
        this.startedOn = startedOn;
        this.endedOn = null;
    }

    public void endOn(LocalDate endedOn) {
        this.endedOn = endedOn;
    }

    public void correctPeriod(LocalDate startedOn, LocalDate endedOn) {
        this.startedOn = startedOn;
        this.endedOn = endedOn;
    }

    public boolean isCurrent() {
        return endedOn == null;
    }
}
