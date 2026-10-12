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
        Map<UUID, List<BookingSubjectRow>> rowsBySubject = allocations.describeSubjects(subjectIds).stream()
                .collect(Collectors.groupingBy(BookingSubjectRow::subjectId, LinkedHashMap::new, Collectors.toList()));
        Map<UUID, BookingSubject> described = new LinkedHashMap<>();
        rowsBySubject.forEach((subjectId, rows) -> described.put(subjectId, new BookingSubject(
                rows.stream().map(BookingSubjectRow::courtId).distinct().toList(),
                new TimeSlot(rows.getFirst().startsAt(), rows.getFirst().endsAt()))));
        return described;
    }
}
