package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({ConfigTestFixture.class, MemberTestFixture.class})
class ShippedMembershipTypeNamingTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    @Autowired
    private MemberService memberships;

    @Autowired
    private ConfigTestFixture configuration;

    @Autowired
    private MemberTestFixture members;

    @Test
    void whenTheInstanceHasStarted_thenItsMembershipTypesCarryTheLanguageTheClubIsShippedWith() {
        // when / then
        assertThat(nameOf(ACTIVE)).isEqualTo("Aktiv");
        assertThat(nameOf(YOUTH)).isEqualTo("Jugend");
    }

    @Test
    void givenAClubThatChangesItsLanguage_whenItIsSaved_thenItsMembershipTypesFollowWithoutARestart() {
        // when
        configuration.speak("en");

        // then
        assertThat(nameOf(ACTIVE)).isEqualTo("Active");
        assertThat(nameOf(YOUTH)).isEqualTo("Youth");
    }

    @Test
    void givenATypeTheClubNamedItself_whenTheClubChangesItsLanguage_thenTheClubsOwnNameStands() {
        // given
        members.renameMembershipType(ACTIVE, "Full member");

        // when
        configuration.speak("en");

        // then
        assertThat(nameOf(ACTIVE)).isEqualTo("Full member");
        assertThat(nameOf(YOUTH)).isEqualTo("Youth");
    }

    private String nameOf(UUID membershipTypeId) {
        return memberships.membershipTypeNameOf(membershipTypeId).orElseThrow();
    }
}
