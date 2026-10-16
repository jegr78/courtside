package org.courtside.facility.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.facility.CourtClosure;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "court_closure")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CourtClosureRow {

    @Id
    private UUID id;

    @Column(name = "court_id", nullable = false)
    private UUID courtId;

    @Column(nullable = false)
    private String name;

    @Column(name = "starts_on", nullable = false)
    private LocalDate startsOn;

    @Column(name = "ends_on", nullable = false)
    private LocalDate endsOn;

    public CourtClosureRow(UUID courtId) {
        this.id = UUID.randomUUID();
        this.courtId = courtId;
    }

    public void changeTo(String name, LocalDate startsOn, LocalDate endsOn) {
        this.name = name;
        this.startsOn = startsOn;
        this.endsOn = endsOn;
    }

    public CourtClosure toClosure() {
        return new CourtClosure(id, courtId, name, startsOn, endsOn);
    }
}
