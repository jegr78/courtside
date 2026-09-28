package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningSchedule;
import org.courtside.facility.OpeningWeek;
import org.courtside.shared.OpeningWindow;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
public class OpeningSchedules {

    private final OpeningHoursVersionRepository versions;
    private final OpeningHoursRepository openingHours;

    public OpeningSchedule load() {
        Map<UUID, List<OpeningHours>> rows = openingHours.findAll().stream()
                .collect(Collectors.groupingBy(OpeningHours::getVersionId));
        return new OpeningSchedule(versions.findAll().stream()
                .map(version -> toWeek(version, rows.getOrDefault(version.getId(), List.of())))
                .toList());
    }

    private static OpeningWeek toWeek(OpeningHoursVersion version, List<OpeningHours> rows) {
        Map<DayOfWeek, OpeningWindow> days = new EnumMap<>(DayOfWeek.class);
        rows.forEach(row -> days.put(row.getDayOfWeek(),
                new OpeningWindow(row.getOpensAt(), row.getClosesAt())));
        return new OpeningWeek(version.getId(), version.getEffectiveFrom(), days);
    }
}
