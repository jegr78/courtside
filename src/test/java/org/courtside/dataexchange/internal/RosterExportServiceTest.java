package org.courtside.dataexchange.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ExternalReferenceService;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.SnapshotEncodingUnsupportedException;
import org.courtside.dataexchange.ImportSourceNotFoundException;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class RosterExportServiceTest extends AbstractIntegrationTest {

    private static final Charset WINDOWS_1252 = Charset.forName("windows-1252");

    @Autowired
    private RosterExportService exports;

    @Autowired
    private MemberTestFixture roster;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    private String exported(String query, UUID membershipTypeId, UUID sourceId) {
        return new String(exports.roster(query, membershipTypeId, sourceId, ',', "UTF-8"),
                StandardCharsets.UTF_8);
    }

    @Test
    void givenPeopleTheRosterHolds_whenItIsExported_thenEachIsARowInTheOrderTheListShows() {
        // given
        UUID adult = roster.createMembershipType("Adult");
        UUID jane = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.assignMembership(jane, adult, LocalDate.of(2026, 1, 1));
        roster.addPerson("John", "Roe", "john.roe@example.org");

        // when
        String written = exported(null, null, null);

        // then
        assertThat(written.lines().skip(1)).containsExactly(
                "\"\",Jane,Doe,jane.doe@example.org,Adult,2026-01-01,",
                "\"\",John,Roe,john.roe@example.org,,,");
    }

    @Test
    void givenASourceThatLinkedThem_whenTheRosterIsExportedForIt_thenEachRowCarriesItsMemberNumber() {
        // given
        UUID jane = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.addPerson("John", "Roe", "john.roe@example.org");
        UUID sourceId = source();
        references.link(sourceId, "4711", jane);

        // when
        String written = exported(null, null, sourceId);

        // then
        assertThat(written.lines().skip(1)).containsExactly(
                "4711,Jane,Doe,jane.doe@example.org,,,",
                "\"\",John,Roe,john.roe@example.org,,,");
    }

    @Test
    void givenAMembershipTypeToNarrowBy_whenTheRosterIsExported_thenOnlyItsCurrentHoldersAreRows() {
        // given
        UUID adult = roster.createMembershipType("Adult");
        UUID student = roster.createMembershipType("Student");
        UUID jane = roster.addPerson("Jane", "Doe", "jane.doe@example.org");
        roster.assignMembership(jane, adult);
        UUID john = roster.addPerson("John", "Roe", "john.roe@example.org");
        roster.assignMembership(john, student);

        // when
        String written = exported(null, adult, null);

        // then
        assertThat(written.lines().skip(1)).hasSize(1);
        assertThat(written).contains("Jane,Doe");
    }

    @Test
    void givenMorePeopleThanOnePageHolds_whenTheRosterIsExported_thenTheFileHoldsEveryOne() {
        // given
        for (int number = 0; number < RosterExportService.PAGE_SIZE + 3; number++) {
            roster.addPerson("Member", "Number%04d".formatted(number), "");
        }

        // when
        String written = exported(null, null, null);

        // then
        assertThat(written.lines().skip(1)).hasSize(RosterExportService.PAGE_SIZE + 3);
        assertThat(written).contains("Number0000").contains("Number0202");
    }

    @Test
    void givenAClubWhoseSpreadsheetReadsWindows1252_whenTheRosterIsExported_thenTheNamesSurvive() {
        // given
        roster.addPerson("Jörg", "Müller", "");

        // when
        byte[] written = exports.roster(null, null, null, ';', "windows-1252");

        // then
        assertThat(new String(written, WINDOWS_1252)).contains(";Jörg;Müller;");
    }

    @Test
    void givenAnEncodingNoCharsetProvides_whenTheRosterIsExported_thenItNamesTheEncodingBack() {
        // when / then
        assertThatThrownBy(() -> exports.roster(null, null, null, ',', "utf-9"))
                .isInstanceOfSatisfying(SnapshotEncodingUnsupportedException.class,
                        refused -> {
                            assertThat(refused.getCode()).isEqualTo("import.snapshot.encodingUnsupported");
                            assertThat(refused.getParams()).containsEntry("encoding", "utf-9");
                        });
    }

    @Test
    void givenASourceTheClubDoesNotHave_whenTheRosterIsExportedForIt_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> exports.roster(null, null, UUID.randomUUID(), ',', "UTF-8"))
                .isInstanceOf(ImportSourceNotFoundException.class);
    }

    private UUID source() {
        return sources.create("membership", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME),
                Map.of(), roster.createMembershipType("Imported"), Set.of(), 10).sourceId();
    }
}
