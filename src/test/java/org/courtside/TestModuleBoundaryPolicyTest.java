package org.courtside;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class TestModuleBoundaryPolicyTest {

    private static final Path BOOKING_TEST =
            Path.of("src/test/java/org/courtside/booking/ExampleTest.java");

    @Test
    void givenAnotherModulesInternalType_whenCheckingTheTestSource_thenTheImportIsRejected() {
        // given
        String source = """
                package org.courtside.booking;
                import org.courtside.facility.internal.CourtRepository;
                class ExampleTest {}
                """;

        // when
        var violations = TestModuleBoundaryPolicy.violations(BOOKING_TEST, source);

        // then
        assertThat(violations).containsExactly(
                "src/test/java/org/courtside/booking/ExampleTest.java imports another module's internal type org.courtside.facility.internal.CourtRepository");
    }

    @Test
    void givenAnotherModulesWildcard_whenCheckingTheTestSource_thenTheImportIsRejected() {
        // given
        String source = """
                package org.courtside.booking;
                import org.courtside.member.*;
                class ExampleTest {}
                """;

        // when
        var violations = TestModuleBoundaryPolicy.violations(BOOKING_TEST, source);

        // then
        assertThat(violations).containsExactly(
                "src/test/java/org/courtside/booking/ExampleTest.java uses a cross-module wildcard import org.courtside.member.*");
    }

    @Test
    void givenAnotherModulesEntityAndRepositoryMutation_whenCheckingTheTestSource_thenSetupIsRejected() {
        // given
        String source = """
                package org.courtside.booking;
                import org.courtside.member.Member;
                import org.courtside.member.MemberRepository;
                class ExampleTest {
                    private MemberRepository members;
                    void arrange() {
                        members.save(new Member(null, null, null));
                    }
                }
                """;

        // when
        var violations = TestModuleBoundaryPolicy.violations(BOOKING_TEST, source);

        // then
        assertThat(violations).containsExactly(
                "src/test/java/org/courtside/booking/ExampleTest.java constructs another module's entity org.courtside.member.Member",
                "src/test/java/org/courtside/booking/ExampleTest.java mutates another module through MemberRepository.save");
    }

    @Test
    void givenFixtureAndReadOnlyProductionApiImports_whenCheckingTheTestSource_thenTheyAreAllowed() {
        // given
        String source = """
                package org.courtside.booking;
                import org.courtside.member.MemberRepository;
                import org.courtside.member.MemberService;
                import org.courtside.member.testfixture.MemberTestFixture;
                class ExampleTest {
                    private MemberRepository members;
                    private MemberService memberships;
                    private MemberTestFixture fixture;
                    long observe() {
                        return members.count() + memberships.activeMembershipTypeIds().size();
                    }
                }
                """;

        // when
        var violations = TestModuleBoundaryPolicy.violations(BOOKING_TEST, source);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void givenARepositoryUsedByTheProductionModule_whenMutatingThroughIt_thenTheImportIsAllowed() {
        // given
        Path dataExchangeTest =
                Path.of("src/test/java/org/courtside/dataexchange/ExampleTest.java");
        String source = """
                package org.courtside.dataexchange;
                import org.courtside.member.MemberRepository;
                class ExampleTest {
                    private MemberRepository members;
                    void exerciseProductionDependency() {
                        members.flush();
                    }
                }
                """;

        // when
        var violations = TestModuleBoundaryPolicy.violations(dataExchangeTest, source);

        // then
        assertThat(violations).isEmpty();
    }

    @Test
    void whenCheckingRepositoryTestSources_thenNoCrossModuleFixtureCouplingRemains() {
        // when
        var violations = TestModuleBoundaryPolicy.violationsIn(Path.of("src/test/java"));

        // then
        assertThat(violations)
                .as("cross-module setup belongs behind a testfixture API")
                .isEmpty();
    }
}
