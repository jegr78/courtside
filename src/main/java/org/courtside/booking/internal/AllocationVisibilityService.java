package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.CourtAllocation;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccount;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AllocationVisibilityService {

    private final BookingRepository bookings;
    private final PersonRepository persons;

    @Transactional(readOnly = true)
    public Map<UUID, AllocationVisibility> resolve(List<CourtAllocation> allocations,
                                                   Optional<UserAccount> viewer) {
        Map<UUID, AllocationVisibility> visibility = allocations.stream()
                .map(CourtAllocation::getBooking)
                .distinct()
                .collect(Collectors.toMap(booking -> booking.getId(), booking ->
                        new AllocationVisibility(viewer
                                .map(account -> account.getId().equals(booking.getBookedBy()))
                                .orElse(false), null)));

        if (viewer.isEmpty()) {
            return visibility;
        }

        Set<UUID> ownBookingIds = visibility.entrySet().stream()
                .filter(entry -> entry.getValue().ownBooking())
                .map(Map.Entry::getKey)
                .collect(Collectors.toSet());
        if (ownBookingIds.isEmpty()) {
            return visibility;
        }

        UUID viewerPersonId = viewer.orElseThrow().getPerson().getId();
        List<Object[]> participantRows = bookings.findMemberParticipantIdsByBooking(ownBookingIds);
        Map<UUID, Person> people = persons.findAllById(participantPersonIds(participantRows, viewerPersonId))
                .stream()
                .collect(Collectors.toMap(Person::getId, Function.identity()));
        Map<UUID, List<String>> lastNames = participantRows.stream()
                .filter(row -> !viewerPersonId.equals(row[1]))
                .filter(row -> people.containsKey(row[1]))
                .collect(Collectors.groupingBy(row -> (UUID) row[0], LinkedHashMap::new,
                        Collectors.mapping(row -> people.get(row[1]).getLastName(), Collectors.toList())));
        ownBookingIds.forEach(bookingId -> visibility.put(bookingId,
                new AllocationVisibility(true, lastNames.getOrDefault(bookingId, List.of()))));
        return visibility;
    }

    private Collection<UUID> participantPersonIds(List<Object[]> rows, UUID viewerPersonId) {
        return rows.stream()
                .map(row -> (UUID) row[1])
                .filter(personId -> !viewerPersonId.equals(personId))
                .collect(Collectors.toSet());
    }

    public record AllocationVisibility(boolean ownBooking, List<String> participantLastNames) {
    }
}
