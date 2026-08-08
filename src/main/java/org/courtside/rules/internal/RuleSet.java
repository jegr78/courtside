package org.courtside.rules.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Entity
@Table(name = "rule_set")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RuleSet {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private boolean active;

    public RuleSet(String name) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.active = true;
    }

    public void rename(String name) {
        this.name = name;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
