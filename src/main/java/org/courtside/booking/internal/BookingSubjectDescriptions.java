package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.BookingSubjects;
import org.courtside.shared.TimeSlot;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class BookingSubjectDescriptions implements BookingSubjects {

    private final CourtAllocationRepository allocations;

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, BookingSubject> describe(Collection<UUID> subjectIds) {
        if (subjectIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, BookingSubject> described = new LinkedHashMap<>();
        described.putAll(subjects(allocations.describeSeriesByFirstOccurrence(subjectIds)));
        described.putAll(subjects(allocations.describeBookings(subjectIds)));
        return described;
    }

    private static Map<UUID, BookingSubject> subjects(List<BookingSubjectRow> rows) {
        Map<UUID, BookingSubject> subjects = new LinkedHashMap<>();
        rows.stream()
                .collect(Collectors.groupingBy(BookingSubjectRow::subjectId, LinkedHashMap::new, Collectors.toList()))
                .forEach((subjectId, subjectRows) -> subjects.put(subjectId, new BookingSubject(
                        subjectRows.stream().map(BookingSubjectRow::courtId).distinct().toList(),
                        new TimeSlot(subjectRows.getFirst().startsAt(), subjectRows.getFirst().endsAt()))));
        return subjects;
    }
}
