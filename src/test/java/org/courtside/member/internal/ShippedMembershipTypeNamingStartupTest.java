package org.courtside.member.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.member.MemberService;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.shared.ShippedNames;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;

@Import({ConfigTestFixture.class, MemberTestFixture.class})
class ShippedMembershipTypeNamingStartupTest extends AbstractIntegrationTest {

    private static final UUID YOUTH = UUID.fromString("cccccccc-0000-0000-0000-000000000002");

    @Autowired
    private ShippedMembershipTypeNaming naming;

    @Autowired
    private MemberService memberships;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private ConfigTestFixture configuration;

    @MockitoSpyBean
    private ShippedNames names;

    @Test
    void givenAClubUsingTheNameAShippedTypeWouldTake_whenTheInstanceStarts_thenItStartsAnyway() {
        // given
        members.createMembershipType("Youth");
        configuration.speak("en");

        // when / then — a runner that throws closes the context, and a club could not start again
        assertThatNoException().isThrownBy(() -> naming.run(null));
        assertThat(memberships.membershipTypeNameOf(YOUTH)).contains("Jugend");
    }

    @Test
    void givenANameNoRowMayCarry_whenTheInstanceStarts_thenItIsNotReportedAsANameInUse() {
        // given — only a bundle this image ships broken names a row this way, and the row stays
        // recognisable because everyLanguage reads the same bundle the stub would otherwise blank
        doReturn(names.everyLanguage("membershipType.youth"))
                .when(names).everyLanguage("membershipType.youth");
        doReturn(" ").when(names).in("membershipType.youth", "de");

        // when / then
        assertThatThrownBy(() -> naming.run(null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
