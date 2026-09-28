package org.courtside.facility;

import org.courtside.shared.OpeningWindow;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.UUID;

@Entity
@Table(name = "opening_hours")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OpeningHours {

    @Id
    @Getter
    private UUID id;

    @Column(name = "version_id", nullable = false)
    @Getter
    private UUID versionId;

    @Column(name = "day_of_week", nullable = false)
    private int dayOfWeek;

    @Column(name = "opens_at", nullable = false)
    @Getter
    private LocalTime opensAt;

    @Column(name = "closes_at", nullable = false)
    @Getter
    private LocalTime closesAt;

    public OpeningHours(UUID versionId, DayOfWeek dayOfWeek, OpeningWindow window) {
        this.id = UUID.randomUUID();
        this.versionId = versionId;
        this.dayOfWeek = dayOfWeek.getValue();
        this.opensAt = window.opensAt();
        this.closesAt = window.closesAt();
    }

    public DayOfWeek getDayOfWeek() {
        return DayOfWeek.of(dayOfWeek);
    }

    public void changeTo(OpeningWindow window) {
        this.opensAt = window.opensAt();
        this.closesAt = window.closesAt();
    }
}
