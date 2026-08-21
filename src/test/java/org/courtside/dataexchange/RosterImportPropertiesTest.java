package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.ChangeSetResolver;
import org.courtside.dataexchange.internal.CsvSnapshot;
import org.courtside.dataexchange.internal.CurrentRoster;
import org.courtside.dataexchange.internal.SnapshotParser;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.quicktheories.QuickTheory.qt;
import static org.quicktheories.generators.SourceDSL.integers;

class RosterImportPropertiesTest {

    private static final long SEED = 2_026_08_21L;
    private static final char[] SEPARATORS = {',', ';', '\t', '|'};
    private static final char[] CELL_ALPHABET = {'a', 'Z', '9', ' ', ',', ';', '\t', '|', '"', '\n', 'ä'};
    private static final Charset[] ENCODINGS = {StandardCharsets.UTF_8, Charset.forName("windows-1252")};
    private static final UUID SOURCE = UUID.fromString("99000000-0000-0000-0000-000000000001");
    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Test
    void givenAnyRosterRenderedAsCsv_whenReadingItBack_thenEveryCellArrivesAsItWentIn() {
        // given / when / then
        qt().withFixedSeed(SEED).withExamples(500)
                .forAll(integers().between(1, 8), integers().between(0, SEPARATORS.length - 1),
                        integers().between(0, ENCODINGS.length - 1), integers().allPositive())
                .check((rowCount, separatorChoice, encodingChoice, shape) -> {
                    char separator = SEPARATORS[separatorChoice];
                    Charset encoding = ENCODINGS[encodingChoice];
                    List<String[]> people = peopleOf(rowCount, shape);
                    CsvSnapshot snapshot = SnapshotParser.parse(
                            rendered(people, separator).getBytes(encoding),
                            columns(), encoding, separator);
                    return snapshot.errors().isEmpty() && carries(snapshot, people);
                });
    }

    @Test
    void givenAnyFileAndAnyRoster_whenResolving_thenEachMemberNumberLandsInExactlyOneChange() {
        // given / when / then
        qt().withFixedSeed(SEED).withExamples(500)
                .forAll(integers().between(0, 8), integers().between(0, 8), integers().between(0, 1))
                .check((inFile, onRoster, wholeRoster) -> {
                    SnapshotMode mode = wholeRoster == 1
                            ? SnapshotMode.FULL_SNAPSHOT
                            : SnapshotMode.UPDATE_ONLY;
                    ResolvedChangeSet resolved = ChangeSetResolver.resolve(snapshotOf(inFile),
                            configuration(), mode, rosterOf(onRoster));
                    return resolved.errors().isEmpty()
                            && eachNumberChangesOnce(resolved)
                            && writesEveryRow(resolved, inFile)
                            && endsOnlyWhatIsAbsent(resolved, mode, inFile, onRoster);
                });
    }

    private static boolean carries(CsvSnapshot snapshot, List<String[]> people) {
        if (snapshot.rows().size() != people.size()) {
            return false;
        }
        for (int index = 0; index < people.size(); index++) {
            CsvSnapshot.SnapshotRow row = snapshot.rows().get(index);
            String[] person = people.get(index);
            if (!row.externalId().equals(person[0])
                    || !person[1].strip().equals(row.values().get(CanonicalField.FIRST_NAME))
                    || !person[2].strip().equals(row.values().get(CanonicalField.LAST_NAME))) {
                return false;
            }
        }
        return true;
    }

    private static boolean eachNumberChangesOnce(ResolvedChangeSet resolved) {
        Set<String> seen = new HashSet<>();
        return resolved.changes().stream().allMatch(change -> seen.add(change.externalId()));
    }

    private static boolean writesEveryRow(ResolvedChangeSet resolved, int inFile) {
        Set<String> written = resolved.changes().stream()
                .filter(change -> change.kind() != ResolvedChangeSet.ChangeKind.END_MEMBERSHIP)
                .map(ResolvedChangeSet.PersonChange::externalId)
                .collect(HashSet::new, HashSet::add, HashSet::addAll);
        return written.equals(numbers(0, inFile));
    }

    private static boolean endsOnlyWhatIsAbsent(ResolvedChangeSet resolved, SnapshotMode mode,
                                                int inFile, int onRoster) {
        Set<String> ended = resolved.changes().stream()
                .filter(change -> change.kind() == ResolvedChangeSet.ChangeKind.END_MEMBERSHIP)
                .map(ResolvedChangeSet.PersonChange::externalId)
                .collect(HashSet::new, HashSet::add, HashSet::addAll);
        Set<String> absent = mode == SnapshotMode.FULL_SNAPSHOT
                ? numbers(inFile, onRoster)
                : Set.of();
        return ended.equals(absent);
    }

    private static Set<String> numbers(int from, int toExclusive) {
        Set<String> numbers = new HashSet<>();
        for (int index = from; index < toExclusive; index++) {
            numbers.add("M" + index);
        }
        return numbers;
    }

    private static List<String[]> peopleOf(int rowCount, int shape) {
        List<String[]> people = new ArrayList<>();
        long walk = shape;
        for (int index = 0; index < rowCount; index++) {
            walk = stepped(walk);
            String firstName = cellOf(walk);
            walk = stepped(walk);
            people.add(new String[] {"M" + index, firstName, cellOf(walk)});
        }
        return people;
    }

    private static long stepped(long state) {
        return state * 6_364_136_223_846_793_005L + 1_442_695_040_888_963_407L;
    }

    private static String cellOf(long state) {
        StringBuilder cell = new StringBuilder();
        long walk = state;
        for (int position = 0; position <= Math.floorMod(state >> 33, 6); position++) {
            walk = stepped(walk);
            cell.append(CELL_ALPHABET[(int) Math.floorMod(walk >> 33, CELL_ALPHABET.length)]);
        }
        return cell.toString();
    }

    // Every cell is quoted, which is what an export tool does when it cannot know what a cell holds.
    private static String rendered(List<String[]> people, char separator) {
        StringBuilder text = new StringBuilder();
        appendRow(text, new String[] {"Member number", "First name", "Last name"}, separator);
        people.forEach(person -> appendRow(text, person, separator));
        return text.toString();
    }

    private static void appendRow(StringBuilder text, String[] cells, char separator) {
        for (int index = 0; index < cells.length; index++) {
            text.append(index == 0 ? "" : separator)
                    .append('"').append(cells[index].replace("\"", "\"\"")).append('"');
        }
        text.append('\n');
    }

    private static Map<String, CanonicalField> columns() {
        return Map.of("Member number", CanonicalField.EXTERNAL_ID,
                "First name", CanonicalField.FIRST_NAME,
                "Last name", CanonicalField.LAST_NAME);
    }

    private static SourceConfiguration configuration() {
        return new SourceConfiguration(SOURCE, "roster-system", "Membership system", ',', "UTF-8",
                columns(), Map.of(), ACTIVE_TYPE,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 100);
    }

    private static CsvSnapshot snapshotOf(int rowCount) {
        List<CsvSnapshot.SnapshotRow> rows = new ArrayList<>();
        for (int index = 0; index < rowCount; index++) {
            Map<CanonicalField, String> values = new EnumMap<>(CanonicalField.class);
            values.put(CanonicalField.FIRST_NAME, "New" + index);
            values.put(CanonicalField.LAST_NAME, "Roe");
            rows.add(new CsvSnapshot.SnapshotRow(index + 1, "M" + index, values));
        }
        return new CsvSnapshot(rows, List.of(), List.of());
    }

    // Every held name differs from the file's, so a matched number is always a change and never
    // silently drops out of the partition this asserts.
    private static CurrentRoster rosterOf(int held) {
        Map<String, UUID> personIds = new HashMap<>();
        Map<UUID, CurrentRoster.RosterPerson> people = new HashMap<>();
        for (int index = 0; index < held; index++) {
            UUID personId = UUID.nameUUIDFromBytes(("person-" + index).getBytes(StandardCharsets.UTF_8));
            personIds.put("M" + index, personId);
            people.put(personId, new CurrentRoster.RosterPerson(personId, "Old" + index, "Roe",
                    null, ACTIVE_TYPE, true));
        }
        return new CurrentRoster(personIds, people, Set.of(ACTIVE_TYPE), Map.of());
    }
}
