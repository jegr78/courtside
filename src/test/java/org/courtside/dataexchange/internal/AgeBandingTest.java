package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.AgeBand;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AgeBandingTest {

    private static final UUID YOUTH = UUID.fromString("44444444-0000-0000-0000-000000000001");
    private static final UUID ADULT = UUID.fromString("44444444-0000-0000-0000-000000000002");
    private static final Map<String, List<AgeBand>> SPLIT =
            Map.of("active", List.of(new AgeBand(0, YOUTH), new AgeBand(18, ADULT)));

    @Test
    void givenAMemberWhoTurnsEighteenNextYear_whenTheYearChanges_thenTheFirstImportOfThatYearMovesThem() {
        // given
        AgeBanding thisYear = new AgeBanding(SPLIT, 2026);
        AgeBanding nextYear = new AgeBanding(SPLIT, 2027);

        // when / then
        assertThat(thisYear.typeFor("active", "31.12.2009")).as("seventeen in 2026").isEqualTo(YOUTH);
        assertThat(nextYear.typeFor("active", "31.12.2009")).as("eighteen in 2027, whatever the day").isEqualTo(ADULT);
    }

    @ParameterizedTest
    @ValueSource(strings = {"03.04.2008", "3.4.2008", "2008-04-03", "2008", " 2008 "})
    void givenEachAcceptedForm_whenItIsRead_thenOnlyItsYearDecides(String cell) {
        // when / then
        assertThat(new AgeBanding(SPLIT, 2026).typeFor("active", cell)).isEqualTo(ADULT);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "soon", "31.02.2010", "2010-13-01", "08", "2030", "1850"})
    void givenACellWithoutAPlausibleYear_whenItIsRead_thenTheCategoryKeepsItsOwnMapping(String cell) {
        // when / then
        assertThat(new AgeBanding(SPLIT, 2026).typeFor("active", cell)).isNull();
    }

    @Test
    void givenACategoryThatIsNotSplit_whenARowIsRead_thenNoBandApplies() {
        // when / then
        assertThat(new AgeBanding(SPLIT, 2026).typeFor("honorary", "2008")).isNull();
        assertThat(new AgeBanding(SPLIT, 2026).splits("honorary")).isFalse();
    }
}
