package org.courtside.booking.series;

import jakarta.persistence.Column;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "booking_series")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingSeries {

    @Id
    private UUID id;

    @Column(name = "card_id", nullable = false)
    private UUID cardId;

    @Getter(AccessLevel.NONE)
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "booking_series_court",
            joinColumns = @JoinColumn(name = "booking_series_id"))
    @OrderColumn(name = "position")
    @Column(name = "court_id", nullable = false)
    private List<UUID> courtIds = new ArrayList<>();

    @Column(name = "starts_on", nullable = false)
    private LocalDate startsOn;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "duration_minutes", nullable = false)
    private short durationMinutes;

    @Column(name = "interval_weeks", nullable = false)
    private short intervalWeeks;

    @Getter(AccessLevel.NONE)
    @Column(nullable = false)
    private short[] weekdays;

    @Column(name = "ends_on")
    private LocalDate endsOn;

    @Column(name = "occurrence_count")
    private Short occurrenceCount;

    private String note;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public BookingSeries(SeriesRule rule, UUID createdBy, String note, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.cardId = rule.cardId();
        this.courtIds = new ArrayList<>(rule.courtIds());
        this.startsOn = rule.startsOn();
        this.startTime = rule.startTime();
        this.durationMinutes = (short) rule.durationMinutes();
        this.intervalWeeks = (short) rule.intervalWeeks();
        this.weekdays = toIsoNumbers(rule.weekdays());
        this.endsOn = rule.endsOn();
        this.occurrenceCount = rule.occurrenceCount() == null ? null : rule.occurrenceCount().shortValue();
        this.note = note;
        this.createdBy = createdBy;
        this.createdAt = createdAt;
    }

    public SeriesRule getRule() {
        Set<DayOfWeek> days = new LinkedHashSet<>();
        for (short weekday : weekdays) {
            days.add(DayOfWeek.of(weekday));
        }
        return new SeriesRule(
                List.copyOf(courtIds), cardId, startsOn, startTime,
                durationMinutes, intervalWeeks, days, endsOn,
                occurrenceCount == null ? null : occurrenceCount.intValue());
    }

    private static short[] toIsoNumbers(Set<DayOfWeek> weekdays) {
        short[] numbers = new short[weekdays.size()];
        int index = 0;
        for (DayOfWeek weekday : weekdays) {
            numbers[index++] = (short) weekday.getValue();
        }
        return numbers;
    }
}
