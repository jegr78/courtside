package org.courtside.shared.internal;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

class ShippedRowLiteralsTest {

    private record SeededRow(String migration, String id, String key) {
    }

    private static final List<SeededRow> ROWS = List.of(
            new SeededRow("V2__booking_card.sql",
                    "11111111-1111-1111-1111-111111111111", "bookingCard.member"),
            new SeededRow("V2__booking_card.sql",
                    "22222222-2222-2222-2222-222222222222", "bookingCard.training"),
            new SeededRow("V2__booking_card.sql",
                    "33333333-3333-3333-3333-333333333333", "bookingCard.leagueMatch"),
            new SeededRow("V2__booking_card.sql",
                    "44444444-4444-4444-4444-444444444444", "bookingCard.courtClosed"),
            new SeededRow("V6__participants.sql",
                    "55555555-5555-5555-5555-555555555555", "participantCard.ballMachine"),
            new SeededRow("V6__participants.sql",
                    "66666666-6666-6666-6666-666666666666", "participantCard.lookingForAPartner"),
            new SeededRow("V5__rules.sql",
                    "aaaaaaaa-0000-0000-0000-000000000001", "ruleSet.standard"),
            new SeededRow("V5__rules.sql",
                    "aaaaaaaa-0000-0000-0000-000000000002", "ruleSet.youth"),
            new SeededRow("V5__rules.sql",
                    "cccccccc-0000-0000-0000-000000000001", "membershipType.active"),
            new SeededRow("V5__rules.sql",
                    "cccccccc-0000-0000-0000-000000000002", "membershipType.youth"));

    @Test
    void givenARowAMigrationSeeds_whenReadingTheNameItWasGiven_thenItIsTheOneTheBaseBundleCarries()
            throws IOException {
        // given — the name a module recognises the row by is the bundle's, not the migration's
        Properties shipped = base();

        // when
        Map<String, String> differing = new LinkedHashMap<>();
        for (SeededRow row : ROWS) {
            String seeded = literalOn(lineOf(row), row);
            String named = shipped.getProperty(row.key());
            if (!seeded.equals(named)) {
                differing.put(row.id(), seeded + " against " + named);
            }
        }

        // then
        assertThat(differing)
                .as("a row whose seeded name is not the one the bundle gives it is never recognised"
                        + " as still carrying it, so the club's language would never reach it")
                .isEmpty();
    }

    @Test
    void whenReadingEveryNameTheImageShips_thenEachOneNamesARowAMigrationActuallySeeds()
            throws IOException {
        // when
        TreeSet<String> covered = new TreeSet<>(ROWS.stream().map(SeededRow::key).toList());

        // then — a name nothing seeds is a name no club ever reads
        assertThat(new TreeSet<>(base().stringPropertyNames())).isEqualTo(covered);
    }

    private static String lineOf(SeededRow row) throws IOException {
        String opening = "('" + row.id() + "'";
        return migration(row.migration()).lines()
                .map(String::trim)
                .filter(line -> line.startsWith(opening))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        row.migration() + " seeds no row under " + row.id()));
    }

    private static String literalOn(String line, SeededRow row) {
        int opening = line.indexOf('\'', line.indexOf(row.id()) + row.id().length() + 1);
        assertThat(opening).as("%s carries no name on its line", row.id()).isNotNegative();
        return line.substring(opening + 1, line.indexOf('\'', opening + 1));
    }

    private static String migration(String name) throws IOException {
        try (InputStream source = ShippedRowLiteralsTest.class.getClassLoader()
                .getResourceAsStream("db/migration/" + name)) {
            assertThat(source).as("%s is on the classpath", name).isNotNull();
            return new String(source.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static Properties base() throws IOException {
        Properties properties = new Properties();
        try (InputStream source = ShippedRowLiteralsTest.class.getClassLoader()
                .getResourceAsStream("seed.properties")) {
            assertThat(source).as("seed.properties is on the classpath").isNotNull();
            properties.load(new InputStreamReader(source, StandardCharsets.UTF_8));
        }
        return properties;
    }
}
