package org.courtside.securityassessment;

import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityAssessmentRoleLabelTest {

    @Test
    void whenLabellingEveryRole_thenEachKeepsTheNameItsSyntheticAccountsAlreadyCarry() {
        // when
        Map<Role, String> labels = Arrays.stream(Role.values())
                .collect(Collectors.toMap(Function.identity(), SecurityAssessmentDataSeeder::roleLabel));

        // then
        assertThat(labels).containsExactlyInAnyOrderEntriesOf(Map.of(
                Role.MEMBER, "Member", Role.TRAINER, "Trainer", Role.SPORT_DIRECTOR, "SportDirector",
                Role.YOUTH_DIRECTOR, "YouthDirector", Role.GROUNDSKEEPER, "Groundskeeper",
                Role.TREASURER, "Treasurer", Role.ADMIN, "Administrator", Role.EXTERNAL, "External"));
    }
}
