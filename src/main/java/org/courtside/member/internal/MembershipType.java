package org.courtside.member.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Entity
@Table(name = "membership_type")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MembershipType {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(name = "rule_set_id")
    private UUID ruleSetId;

    @Column(nullable = false)
    private boolean active;

    public MembershipType(String name, UUID ruleSetId) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.ruleSetId = ruleSetId;
        this.active = true;
    }

    public void changeTo(String name, UUID ruleSetId) {
        this.name = name;
        this.ruleSetId = ruleSetId;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
