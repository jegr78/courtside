package org.courtside.member;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

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

    public Member(UUID personId, UUID membershipTypeId) {
        this.id = UUID.randomUUID();
        this.personId = personId;
        this.membershipTypeId = membershipTypeId;
    }

    public void assignTo(UUID membershipTypeId) {
        this.membershipTypeId = membershipTypeId;
    }
}
