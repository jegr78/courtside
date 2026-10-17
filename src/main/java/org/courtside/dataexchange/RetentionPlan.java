package org.courtside.dataexchange;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@NullMarked
public final class RetentionPlan {

    private RetentionPlan() {
    }

    public enum BlockReason {
        ADMINISTRATOR,
        NAMED_IN_BOOKINGS,
        ON_A_WAITING_LIST
    }

    public record Policy(RetentionCategory category, @Nullable Integer retainMonths) {
    }

    public record Bookings(Instant endedBefore, long bookings, long series) {
    }

    public record FormerMembers(LocalDate membershipEndedBefore, long people, long accounts) {
    }

    public record Blocked(UUID personId, BlockReason reason) {
    }

    public record Preview(UUID previewId, Instant expiresAt, @Nullable Bookings bookings,
                          @Nullable FormerMembers formerMembers, List<Blocked> blocked) {

        public Preview {
            blocked = List.copyOf(blocked);
        }
    }

    public record Run(UUID runId, long bookingsPseudonymised, long seriesPseudonymised,
                      long formerMembersRemoved, long accountsRemoved, long formerMembersSkipped) {
    }
}
