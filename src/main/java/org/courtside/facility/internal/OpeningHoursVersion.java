package org.courtside.facility.internal;

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
@Table(name = "opening_hours_version")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OpeningHoursVersion {

    @Id
    private UUID id;

    @Column(name = "effective_from")
    private LocalDate effectiveFrom;

    public OpeningHoursVersion(LocalDate effectiveFrom) {
        this.id = UUID.randomUUID();
        this.effectiveFrom = effectiveFrom;
    }
}
