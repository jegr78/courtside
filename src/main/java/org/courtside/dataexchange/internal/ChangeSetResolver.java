package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ResolvedChangeSet;
import org.courtside.dataexchange.SnapshotMode;
import org.courtside.dataexchange.SourceConfiguration;
import org.courtside.member.PersonFieldLimits;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.UUID;

public final class ChangeSetResolver {

    private ChangeSetResolver() {
    }

    public static ResolvedChangeSet resolve(CsvSnapshot snapshot, SourceConfiguration configuration,
                                            SnapshotMode mode, CurrentRoster roster) {
        requireUsableMembershipTypes(snapshot, configuration, roster);
        List<ResolvedChangeSet.PersonChange> changes = new ArrayList<>();
        List<ResolvedChangeSet.PossibleDuplicate> duplicates = new ArrayList<>();
        List<ResolvedChangeSet.RowError> rowErrors = new ArrayList<>(errorsOf(snapshot));
        List<AddressAnAccountWouldGoTo> addresses = new ArrayList<>();
        Set<String> present = new HashSet<>();
        for (CsvSnapshot.SnapshotRow row : snapshot.rows()) {
            present.add(row.externalId());
            UUID personId = roster.personIdsByExternalId().get(row.externalId());
            ResolvedChangeSet.RowError unusable =
                    unusableValueOf(row, configuration, personId == null);
            if (unusable != null) {
                rowErrors.add(unusable);
                continue;
            }
            if (personId == null) {
                Optional<ResolvedChangeSet.PossibleDuplicate> duplicate = duplicateOf(row, roster);
                duplicate.ifPresent(duplicates::add);
                ResolvedChangeSet.PersonChange creation =
                        creationOf(row, configuration, roster, duplicate.isPresent());
                changes.add(creation);
                recordAddress(addresses, creation,
                        addressAfterThisRun(row, configuration, null));
            } else {
                CurrentRoster.RosterPerson current = roster.peopleById().get(personId);
                updateOf(row, personId, configuration, roster).ifPresent(update -> {
                    changes.add(update);
                    recordAddress(addresses, update,
                            addressAfterThisRun(row, configuration, current));
                });
            }
        }
        List<ResolvedChangeSet.PersonChange> endings = endingsFor(mode, present, roster);
        changes.addAll(endings);
        return new ResolvedChangeSet(changes, rowErrors, duplicates,
                sharedAddressesAmong(addresses, roster), removalsOf(endings.size(), roster));
    }

    private static void recordAddress(List<AddressAnAccountWouldGoTo> addresses,
                                      ResolvedChangeSet.PersonChange change, String address) {
        if (change.account() == ResolvedChangeSet.AccountOutcome.CREATE) {
            addresses.add(new AddressAnAccountWouldGoTo(change.rowNumber(), change.externalId(),
                    address, change.kind() == ResolvedChangeSet.ChangeKind.CREATE));
        }
    }

    // The people already on the address plus the ones this run puts there. A row that moves
    // somebody onto it counts twice at worst, which errs towards showing more sharing, not less.
    private static List<ResolvedChangeSet.SharedAddress> sharedAddressesAmong(
            List<AddressAnAccountWouldGoTo> addresses, CurrentRoster roster) {
        Map<String, Long> newcomers = addresses.stream()
                .filter(AddressAnAccountWouldGoTo::newPerson)
                .collect(Collectors.groupingBy(AddressAnAccountWouldGoTo::address,
                        Collectors.counting()));
        List<ResolvedChangeSet.SharedAddress> shared = new ArrayList<>();
        addresses.forEach(use -> {
            int sharedBy = roster.peopleByAddress().getOrDefault(use.address(), 0)
                    + newcomers.getOrDefault(use.address(), 0L).intValue();
            if (sharedBy > 1) {
                shared.add(new ResolvedChangeSet.SharedAddress(use.rowNumber(), use.externalId(),
                        sharedBy));
            }
        });
        return shared;
    }

    // An empty cell in an owned column says the file has nothing to say about the address, so the
    // one already on file stays - the same rule the update itself follows.
    private static String addressAfterThisRun(CsvSnapshot.SnapshotRow row,
                                              SourceConfiguration configuration,
                                              CurrentRoster.RosterPerson current) {
        String fromFile = row.values().get(CanonicalField.EMAIL);
        boolean owned = configuration.ownedFields().contains(CanonicalField.EMAIL);
        if (current == null) {
            return fromFile;
        }
        return owned && fromFile != null && !fromFile.isEmpty() ? fromFile : current.email();
    }

    private record AddressAnAccountWouldGoTo(int rowNumber, String externalId, String address,
                                             boolean newPerson) {
    }

    private static ResolvedChangeSet.PersonChange creationOf(CsvSnapshot.SnapshotRow row,
                                                             SourceConfiguration configuration,
                                                             CurrentRoster roster,
                                                             boolean possibleDuplicate) {
        Map<CanonicalField, String> values = new EnumMap<>(CanonicalField.class);
        values.putAll(row.values());
        values.remove(CanonicalField.MEMBERSHIP_TYPE);
        UUID membershipTypeId = membershipTypeOf(row, configuration);
        return new ResolvedChangeSet.PersonChange(ResolvedChangeSet.ChangeKind.CREATE,
                row.rowNumber(), row.externalId(), null, values, membershipTypeId,
                accountOutcomeOf(roster, false, membershipTypeId, possibleDuplicate,
                        addressAfterThisRun(row, configuration, null)));
    }

    private static Optional<ResolvedChangeSet.PersonChange> updateOf(
            CsvSnapshot.SnapshotRow row, UUID personId, SourceConfiguration configuration,
            CurrentRoster roster) {
        CurrentRoster.RosterPerson current = roster.peopleById().get(personId);
        Map<CanonicalField, String> changed = new EnumMap<>(CanonicalField.class);
        row.values().forEach((field, value) -> {
            if (field == CanonicalField.MEMBERSHIP_TYPE || !configuration.ownedFields().contains(field)) {
                return;
            }
            // An empty cell in an export means "not kept here", not "delete it": clearing an
            // address this way would leave an account nobody can send a reset to.
            if (field == CanonicalField.EMAIL && value.isEmpty()) {
                return;
            }
            if (!value.equals(heldValueOf(current, field))) {
                changed.put(field, value);
            }
        });
        UUID membershipTypeId = ownedMembershipTypeOf(row, configuration, current);
        ResolvedChangeSet.AccountOutcome account = accountOutcomeOf(roster,
                roster.personIdsHoldingAnAccount().contains(personId),
                membershipTypeAfterThisRun(membershipTypeId, current), false,
                addressAfterThisRun(row, configuration, current));
        if (changed.isEmpty() && membershipTypeId == null
                && account != ResolvedChangeSet.AccountOutcome.CREATE) {
            return Optional.empty();
        }
        return Optional.of(new ResolvedChangeSet.PersonChange(
                ResolvedChangeSet.ChangeKind.UPDATE, row.rowNumber(), row.externalId(), personId,
                changed, membershipTypeId, account));
    }

    // An account is a membership's benefit, so a lapsed member whose row writes no membership is
    // answered by the type they would hold afterwards: none.
    private static UUID membershipTypeAfterThisRun(UUID written, CurrentRoster.RosterPerson current) {
        if (written != null) {
            return written;
        }
        return current != null && current.membershipCurrent() ? current.membershipTypeId() : null;
    }

    private static ResolvedChangeSet.AccountOutcome accountOutcomeOf(
            CurrentRoster roster, boolean holdsAnAccount, UUID membershipTypeId,
            boolean possibleDuplicate, String email) {
        if (holdsAnAccount) {
            return ResolvedChangeSet.AccountOutcome.ALREADY_HELD;
        }
        if (membershipTypeId == null
                || !roster.membershipTypeIdsGrantingAnAccount().contains(membershipTypeId)) {
            return ResolvedChangeSet.AccountOutcome.MEMBERSHIP_TYPE_GRANTS_NONE;
        }
        if (possibleDuplicate) {
            return ResolvedChangeSet.AccountOutcome.POSSIBLE_DUPLICATE;
        }
        if (email == null || email.isBlank()) {
            return ResolvedChangeSet.AccountOutcome.NO_ADDRESS;
        }
        return ResolvedChangeSet.AccountOutcome.CREATE;
    }

    private static UUID ownedMembershipTypeOf(CsvSnapshot.SnapshotRow row,
                                              SourceConfiguration configuration,
                                              CurrentRoster.RosterPerson current) {
        if (!configuration.ownedFields().contains(CanonicalField.MEMBERSHIP_TYPE)) {
            return null;
        }
        UUID requested = mappedMembershipTypeOf(row, configuration);
        if (requested == null || current == null) {
            return requested;
        }
        return requested.equals(current.membershipTypeId()) && current.membershipCurrent()
                ? null : requested;
    }

    private static String heldValueOf(CurrentRoster.RosterPerson person, CanonicalField field) {
        if (person == null) {
            return null;
        }
        return switch (field) {
            case FIRST_NAME -> person.firstName();
            case LAST_NAME -> person.lastName();
            case EMAIL -> person.email();
            case EXTERNAL_ID, MEMBERSHIP_TYPE -> null;
        };
    }

    private static Optional<ResolvedChangeSet.PossibleDuplicate> duplicateOf(
            CsvSnapshot.SnapshotRow row, CurrentRoster roster) {
        return roster.personIdsByNameKey()
                .getOrDefault(nameKeyOf(row.values()), List.of()).stream()
                .findFirst()
                .map(personId -> new ResolvedChangeSet.PossibleDuplicate(
                        row.rowNumber(), row.externalId(), personId));
    }

    public static String nameKeyOf(Map<CanonicalField, String> values) {
        return nameKeyOf(values.get(CanonicalField.FIRST_NAME),
                values.get(CanonicalField.LAST_NAME));
    }

    public static String nameKeyOf(String firstName, String lastName) {
        return (nullSafe(firstName) + " " + nullSafe(lastName)).strip().toLowerCase(Locale.ROOT);
    }

    private static List<ResolvedChangeSet.PersonChange> endingsFor(SnapshotMode mode,
                                                                  Set<String> present,
                                                                  CurrentRoster roster) {
        if (mode != SnapshotMode.FULL_SNAPSHOT) {
            return List.of();
        }
        List<ResolvedChangeSet.PersonChange> endings = new ArrayList<>();
        roster.personIdsByExternalId().forEach((externalId, personId) -> {
            CurrentRoster.RosterPerson person = roster.peopleById().get(personId);
            if (!present.contains(externalId) && person != null && person.membershipCurrent()) {
                endings.add(new ResolvedChangeSet.PersonChange(
                        ResolvedChangeSet.ChangeKind.END_MEMBERSHIP, 0, externalId, personId,
                        Map.of(), null, ResolvedChangeSet.AccountOutcome.NOT_ASKED));
            }
        });
        return endings;
    }

    private static ResolvedChangeSet.RemovalCounts removalsOf(int removed, CurrentRoster roster) {
        int linked = (int) roster.peopleById().values().stream()
                .filter(CurrentRoster.RosterPerson::membershipCurrent)
                .count();
        return new ResolvedChangeSet.RemovalCounts(removed, linked,
                linked == 0 ? 0 : (int) Math.ceil(removed * 100.0 / linked));
    }

    private static void requireUsableMembershipTypes(CsvSnapshot snapshot,
                                                     SourceConfiguration configuration,
                                                     CurrentRoster roster) {
        Set<String> unmapped = new TreeSet<>();
        Set<String> inactive = new TreeSet<>();
        for (CsvSnapshot.SnapshotRow row : snapshot.rows()) {
            String value = row.values().get(CanonicalField.MEMBERSHIP_TYPE);
            if (value == null || value.isBlank()) {
                continue;
            }
            UUID typeId = configuration.membershipTypes().get(value);
            if (typeId == null) {
                unmapped.add(value);
            } else if (!roster.activeMembershipTypeIds().contains(typeId)) {
                inactive.add(value);
            }
        }
        if (!unmapped.isEmpty()) {
            throw new SnapshotBlockedException("import.snapshot.membershipType.unmapped",
                    Map.of("values", List.copyOf(unmapped)));
        }
        if (!inactive.isEmpty()) {
            throw new SnapshotBlockedException("import.snapshot.membershipType.inactive",
                    Map.of("values", List.copyOf(inactive)));
        }
    }

    // A creation must hold a type, so a file that names none falls back to the source's. An update
    // must not: a blank cell says the file has nothing to say, not that this member changed category.
    private static UUID membershipTypeOf(CsvSnapshot.SnapshotRow row,
                                         SourceConfiguration configuration) {
        UUID mapped = mappedMembershipTypeOf(row, configuration);
        return mapped == null ? configuration.defaultMembershipTypeId() : mapped;
    }

    private static UUID mappedMembershipTypeOf(CsvSnapshot.SnapshotRow row,
                                               SourceConfiguration configuration) {
        String value = row.values().get(CanonicalField.MEMBERSHIP_TYPE);
        return value == null || value.isBlank() ? null : configuration.membershipTypes().get(value);
    }

    private static List<ResolvedChangeSet.RowError> errorsOf(CsvSnapshot snapshot) {
        return snapshot.errors().stream()
                .map(error -> new ResolvedChangeSet.RowError(error.rowNumber(), error.code(),
                        error.params()))
                .toList();
    }

    // A creation writes every field; an update writes only what the source owns, so a value this
    // source would never write cannot stop the row.
    private static ResolvedChangeSet.RowError unusableValueOf(CsvSnapshot.SnapshotRow row,
                                                              SourceConfiguration configuration,
                                                              boolean creation) {
        for (CanonicalField field : List.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME,
                CanonicalField.EMAIL)) {
            if (!creation && !configuration.ownedFields().contains(field)) {
                continue;
            }
            String value = row.values().get(field);
            boolean usable = field == CanonicalField.EMAIL
                    ? PersonFieldLimits.isUsableOrAbsentEmail(value)
                    : PersonFieldLimits.isUsableName(value);
            if (!usable) {
                return new ResolvedChangeSet.RowError(row.rowNumber(),
                        "import.snapshot.row.valueUnusable", Map.of("canonicalField", field.name()));
            }
        }
        return null;
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }
}
