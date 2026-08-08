package org.courtside.facility;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Entity
@Table(name = "court")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Court {

    @Id
    private UUID id;

    @Column(nullable = false)
    private int number;

    @Column
    private String name;

    @Column(nullable = false)
    private boolean active;

    public Court(int number, String name) {
        this.id = UUID.randomUUID();
        this.number = number;
        this.name = name;
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }

    public void activate() {
        this.active = true;
    }

    public void changeTo(int number, String name) {
        this.number = number;
        this.name = name;
    }
}
