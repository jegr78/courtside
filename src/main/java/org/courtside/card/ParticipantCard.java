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
@Table(name = "participant_card")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ParticipantCard {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String label;

    @Column(nullable = false)
    private boolean active;

    private Integer capacity;

    public boolean isLimited() {
        return capacity != null;
    }

    public ParticipantCard(String label, Integer capacity) {
        this.id = UUID.randomUUID();
        this.label = label;
        this.capacity = capacity;
        this.active = true;
    }

    public void changeTo(String label, Integer capacity) {
        this.label = label;
        this.capacity = capacity;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
