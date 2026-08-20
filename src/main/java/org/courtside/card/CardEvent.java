package org.courtside.card;

import org.courtside.identity.Role;
import org.courtside.shared.DomainEventRecord;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public sealed interface CardEvent extends DomainEventRecord {

    UUID cardId();

    @Override
    default UUID subjectId() {
        return cardId();
    }

    record BookingCardAdded(UUID cardId, List<Role> allowedRoles, List<Role> managingRoles,
                            List<Short> allowedPlayerCounts, boolean countsAgainstLimits,
                            boolean guestAllowed, boolean showGenericOccupancy) implements CardEvent {

        static final String TYPE = "card.bookingCard.added";

        public BookingCardAdded {
            allowedRoles = sorted(allowedRoles);
            managingRoles = sorted(managingRoles);
            allowedPlayerCounts = List.copyOf(allowedPlayerCounts);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record BookingCardChanged(UUID cardId, List<Role> allowedRoles, List<Role> managingRoles,
                              List<Short> allowedPlayerCounts, boolean countsAgainstLimits,
                              boolean guestAllowed, boolean showGenericOccupancy,
                              List<String> changedFields) implements CardEvent {

        static final String TYPE = "card.bookingCard.changed";

        public BookingCardChanged {
            allowedRoles = sorted(allowedRoles);
            managingRoles = sorted(managingRoles);
            allowedPlayerCounts = List.copyOf(allowedPlayerCounts);
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record BookingCardAvailabilityChanged(UUID cardId, boolean active) implements CardEvent {

        static final String TYPE = "card.bookingCard.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record ParticipantCardAdded(UUID cardId, Integer capacity) implements CardEvent {

        static final String TYPE = "card.participantCard.added";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record ParticipantCardChanged(UUID cardId, Integer capacity, List<String> changedFields)
            implements CardEvent {

        static final String TYPE = "card.participantCard.changed";

        public ParticipantCardChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record ParticipantCardAvailabilityChanged(UUID cardId, boolean active) implements CardEvent {

        static final String TYPE = "card.participantCard.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    private static List<Role> sorted(Collection<Role> roles) {
        return roles.stream().sorted(Comparator.comparing(Role::name)).toList();
    }
}
