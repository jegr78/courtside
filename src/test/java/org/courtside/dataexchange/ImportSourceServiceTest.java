package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.dataexchange.CanonicalField.EMAIL;
import static org.courtside.dataexchange.CanonicalField.EXTERNAL_ID;
import static org.courtside.dataexchange.CanonicalField.FIRST_NAME;
import static org.courtside.dataexchange.CanonicalField.LAST_NAME;
import static org.courtside.dataexchange.CanonicalField.MEMBERSHIP_TYPE;

class ImportSourceServiceTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID OTHER_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    @Autowired
    private ImportSourceService sources;

    @Test
    void givenACompleteConfiguration_whenTheSourceIsCreated_thenItReadsBackAsGiven() {
        // given
        Map<String, CanonicalField> columns = columns();

        // when
        UUID id = sources.create("roster-system", "Membership system", columns,
                Map.of("A", ACTIVE_TYPE), ACTIVE_TYPE, Set.of(FIRST_NAME, LAST_NAME), 10).sourceId();

        // then
        SourceConfiguration configuration = sources.configurationOf(id);
        assertThat(configuration.sourceKey()).isEqualTo("roster-system");
        assertThat(configuration.columns()).isEqualTo(columns);
        assertThat(configuration.membershipTypes()).containsExactly(Map.entry("A", ACTIVE_TYPE));
        assertThat(configuration.ownedFields()).containsExactlyInAnyOrder(FIRST_NAME, LAST_NAME);
        assertThat(configuration.removalWarningPercent()).isEqualTo(10);
    }

    @Test
    void givenAColumnMappingWithoutTheExternalId_whenCreatingTheSource_thenItIsRefused() {
        // given
        Map<String, CanonicalField> withoutTheKey = new LinkedHashMap<>(columns());
        withoutTheKey.values().remove(EXTERNAL_ID);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", withoutTheKey,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code")
                .isEqualTo("import.source.columns.incomplete");
    }

    @Test
    void givenTwoHeadersForOneField_whenCreatingTheSource_thenTheAmbiguityIsRefused() {
        // given
        Map<String, CanonicalField> ambiguous = new LinkedHashMap<>(columns());
        ambiguous.put("Surname", LAST_NAME);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", ambiguous,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code")
                .isEqualTo("import.source.columns.ambiguous");
    }

    @Test
    void givenASourceThatWouldOwnTheKeyItIsMatchedBy_whenCreatingIt_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(EXTERNAL_ID), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code")
                .isEqualTo("import.source.ownedFields.externalId");
    }

    @Test
    void givenAMappingOntoATypeTheClubDoesNotHave_whenCreatingTheSource_thenItIsRefused() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", columns(),
                Map.of("A", absent), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code")
                .isEqualTo("import.source.membershipType.unknown");
    }

    @Test
    void givenAKeyAnotherSourceHolds_whenCreatingASecond_thenItIsAnsweredAsTaken() {
        // given
        sources.create("roster-system", "Membership system", columns(), Map.of(), ACTIVE_TYPE, Set.of(), 10);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Another system", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceKeyTakenException.class);
    }

    @Test
    void givenAThresholdOutsideTheScale_whenCreatingTheSource_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(), 101))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code")
                .isEqualTo("import.source.removalWarningPercent.outOfRange");
    }

    @Test
    void givenASourceConfiguredWrongly_whenEveryPartIsChanged_thenEveryPartHolds() {
        // given
        UUID id = sources.create("roster-system", "Membership system", columns(),
                Map.of("A", ACTIVE_TYPE), ACTIVE_TYPE, Set.of(FIRST_NAME), 10).sourceId();
        Map<String, CanonicalField> corrected = new LinkedHashMap<>();
        corrected.put("Member no.", EXTERNAL_ID);
        corrected.put("Given name", FIRST_NAME);
        corrected.put("Family name", LAST_NAME);
        corrected.put("E-mail", EMAIL);
        corrected.put("Category", MEMBERSHIP_TYPE);

        // when
        sources.change(id, "club-registry", "The other system", corrected,
                Map.of("Senior", OTHER_TYPE), ACTIVE_TYPE, Set.of(LAST_NAME, EMAIL, MEMBERSHIP_TYPE), 25);

        // then
        SourceConfiguration configuration = sources.configurationOf(id);
        assertThat(configuration.sourceKey()).isEqualTo("club-registry");
        assertThat(configuration.displayName()).isEqualTo("The other system");
        assertThat(configuration.columns()).isEqualTo(corrected);
        assertThat(configuration.membershipTypes()).containsExactly(Map.entry("Senior", OTHER_TYPE));
        assertThat(configuration.ownedFields())
                .containsExactlyInAnyOrder(LAST_NAME, EMAIL, MEMBERSHIP_TYPE);
        assertThat(configuration.removalWarningPercent()).isEqualTo(25);
    }

    @Test
    void givenAnUnknownSource_whenReadingItsConfiguration_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000ab");

        // when / then
        assertThatThrownBy(() -> sources.configurationOf(absent))
                .isInstanceOf(ImportSourceNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAColumnHeaderWithPadding_whenCreatingASource_thenItIsStoredAsTheFileWillDeliverIt() {
        // given
        Map<String, CanonicalField> padded = new LinkedHashMap<>();
        padded.put("  Member number  ", EXTERNAL_ID);
        padded.put("First name", FIRST_NAME);
        padded.put("Last name", LAST_NAME);
        padded.put("  Email  ", EMAIL);

        // when
        SourceConfiguration configuration = sources.create("roster-system", "  Membership system  ",
                padded, Map.of("  A  ", ACTIVE_TYPE), ACTIVE_TYPE, Set.of(), 10);

        // then
        assertThat(configuration.columns()).containsKey("Member number");
        assertThat(configuration.membershipTypes()).containsKey("A");
        assertThat(configuration.displayName()).isEqualTo("Membership system");
    }

    @Test
    void givenAColumnHeaderOfOnlyWhitespace_whenCreatingASource_thenTheReasonIsNamed() {
        // given
        Map<String, CanonicalField> blank = new LinkedHashMap<>(columns());
        blank.put("   ", MEMBERSHIP_TYPE);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", blank,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columns.headerUnusable");
    }

    @Test
    void givenASourceKeyLongerThanTheContractAllows_whenCreatingASource_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("k".repeat(41), "Membership system", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.sourceKey.tooLong");
    }

    @Test
    void givenAColumnHeaderLongerThanTheContractAllows_whenCreatingASource_thenItIsRefused() {
        // given
        Map<String, CanonicalField> tooLong = new LinkedHashMap<>(columns());
        tooLong.put("h".repeat(121), MEMBERSHIP_TYPE);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", tooLong,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columns.headerUnusable");
    }

    @Test
    void givenTwoHeadersThatDifferOnlyInPadding_whenCreatingASource_thenTheRepetitionIsNamed() {
        // given
        Map<String, CanonicalField> repeated = new LinkedHashMap<>();
        repeated.put("Member number", EXTERNAL_ID);
        repeated.put("  Member number  ", FIRST_NAME);
        repeated.put("Last name", LAST_NAME);
        repeated.put("Email", EMAIL);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", repeated,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columns.headerRepeated");
    }

    @Test
    void givenTwoCategoryValuesThatDifferOnlyInPadding_whenCreatingASource_thenTheRepetitionIsNamed() {
        // given
        Map<String, UUID> repeated = new LinkedHashMap<>();
        repeated.put("A", ACTIVE_TYPE);
        repeated.put(" A ", OTHER_TYPE);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", columns(),
                repeated, ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.membershipTypes.valueRepeated");
    }

    @Test
    void givenAHeaderHoldingAControlCharacter_whenCreatingASource_thenItIsRefusedRatherThanStored() {
        // given
        Map<String, CanonicalField> withControl = new LinkedHashMap<>(columns());
        withControl.put("Category\u0000", MEMBERSHIP_TYPE);

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", withControl,
                Map.of(), ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columns.headerUnusable");
    }

    @Test
    void givenMoreCategoryValuesThanASourceMaps_whenCreatingASource_thenItIsRefused() {
        // given
        Map<String, UUID> tooMany = new LinkedHashMap<>();
        for (int entry = 0; entry <= 200; entry++) {
            tooMany.put("value-" + entry, ACTIVE_TYPE);
        }

        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", columns(),
                tooMany, ACTIVE_TYPE, Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.membershipTypes.tooMany");
    }

    private static Map<String, CanonicalField> columns() {
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        columns.put("Member number", EXTERNAL_ID);
        columns.put("First name", FIRST_NAME);
        columns.put("Last name", LAST_NAME);
        columns.put("Email", EMAIL);
        return columns;
    }
}
