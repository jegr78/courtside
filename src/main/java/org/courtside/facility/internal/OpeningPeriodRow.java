package org.courtside.facility.internal;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
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
import org.courtside.facility.OpeningPeriod;
import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "opening_period")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OpeningPeriodRow {

    @Id
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OpeningPeriod.Kind kind;

    @Column(nullable = false)
    private String name;

    @Column(name = "starts_on", nullable = false)
    private LocalDate startsOn;

    @Column(name = "ends_on", nullable = false)
    private LocalDate endsOn;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "opening_period_hours", joinColumns = @JoinColumn(name = "period_id"))
    private Set<Hours> hours = new HashSet<>();

    public OpeningPeriodRow(UUID id) {
        this.id = id;
    }

    public void changeTo(OpeningPeriod.Kind kind, String name, LocalDate startsOn, LocalDate endsOn,
                         Map<DayOfWeek, OpeningWindow> days) {
        this.kind = kind;
        this.name = name;
        this.startsOn = startsOn;
        this.endsOn = endsOn;
        this.hours.clear();
        days.forEach((day, window) -> hours.add(new Hours(day.getValue(), window.opensAt(), window.closesAt())));
    }

    public OpeningPeriod toPeriod() {
        Map<DayOfWeek, OpeningWindow> days = new EnumMap<>(DayOfWeek.class);
        hours.forEach(row -> days.put(DayOfWeek.of(row.dayOfWeek), new OpeningWindow(row.opensAt, row.closesAt)));
        return new OpeningPeriod(id, kind, name, startsOn, endsOn, days);
    }

    @Embeddable
    @NoArgsConstructor(access = AccessLevel.PROTECTED)
    static class Hours {

        @Column(name = "day_of_week", nullable = false)
        private int dayOfWeek;

        @Column(name = "opens_at", nullable = false)
        private LocalTime opensAt;

        @Column(name = "closes_at", nullable = false)
        private LocalTime closesAt;

        Hours(int dayOfWeek, LocalTime opensAt, LocalTime closesAt) {
            this.dayOfWeek = dayOfWeek;
            this.opensAt = opensAt;
            this.closesAt = closesAt;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Hours that && dayOfWeek == that.dayOfWeek;
        }

        @Override
        public int hashCode() {
            return Integer.hashCode(dayOfWeek);
        }
    }
}
