package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class ExternalReferenceServiceTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private IdentityTestFixture identities;

    @Test
    void whenARecordIsLinkedToAPerson_thenThatPersonAnswersForItsExternalId() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");

        // when
        references.link(source, "4711", jane);

        // then
        assertThat(personIdsOf(source)).isEqualTo(Map.of("4711", jane));
    }

    @Test
    void givenALinkedRecord_whenTheReferencesAreListed_thenEachCarriesThePersonsName() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");
        references.link(source, "4711", jane);

        // when
        var page = references.list(source, null, 50);

        // then
        assertThat(page.items()).singleElement().satisfies(link -> {
            assertThat(link.externalId()).isEqualTo("4711");
            assertThat(link.personName()).isEqualTo("Jane Doe");
        });
    }

    @Test
    void whenARecordIsLinked_thenTheAnswerAlreadyNamesThePerson() {
        // given
        UUID source = source("roster-system");
        UUID john = person("John", "Roe");

        // when
        ExternalLink link = references.link(source, "4712", john);

        // then
        assertThat(link.personName()).isEqualTo("John Roe");
    }

    @Test
    void givenAMemberNumberWithPadding_whenLinking_thenItIsStoredWithoutIt() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");

        // when
        references.link(source, "  4711  ", jane);

        // then
        assertThat(personIdsOf(source)).isEqualTo(Map.of("4711", jane));
    }

    @Test
    void givenAnExternalIdHeldByOnePerson_whenLinkingItToAnother_thenItIsRefusedAsTaken() {
        // given
        UUID source = source("roster-system");
        references.link(source, "4711", person("Jane", "Doe"));
        UUID john = person("John", "Roe");

        // when / then
        assertThatThrownBy(() -> references.link(source, "4711", john))
                .isInstanceOf(ExternalIdTakenException.class)
                .hasMessageContaining("4711");
    }

    @Test
    void givenAPersonLinkedFromOneSource_whenTheyAreLinkedFromAnother_thenBothReferencesStand() {
        // given
        UUID first = source("roster-system");
        UUID second = source("club-registry");
        UUID jane = person("Jane", "Doe");
        references.link(first, "4711", jane);

        // when
        references.link(second, "A-90", jane);

        // then
        assertThat(personIdsOf(first)).isEqualTo(Map.of("4711", jane));
        assertThat(personIdsOf(second)).isEqualTo(Map.of("A-90", jane));
    }

    @Test
    void givenAPersonLinkedFromASource_whenASecondIdOfThatSourceIsLinked_thenItIsRefused() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");
        references.link(source, "4711", jane);

        // when / then
        assertThatThrownBy(() -> references.link(source, "4712", jane))
                .isInstanceOf(PersonAlreadyLinkedException.class);
    }

    @Test
    void givenALinkThatAlreadySaysThis_whenItIsMadeAgain_thenItStands() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");
        ExternalLink first = references.link(source, "4711", jane);

        // when
        ExternalLink again = references.link(source, "4711", jane);

        // then
        assertThat(again.linkedAt()).isEqualTo(first.linkedAt());
        assertThat(personIdsOf(source)).isEqualTo(Map.of("4711", jane));
    }

    @Test
    void givenALinkedRecord_whenItIsUnlinked_thenTheReferenceIsGoneAndThePersonRemains() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");
        references.link(source, "4711", jane);

        // when
        references.unlink(source, "4711");

        // then
        assertThat(personIdsOf(source)).isEmpty();
        assertThat(identities.personExists(jane)).isTrue();
    }

    @Test
    void givenNoSuchReference_whenUnlinking_thenItIsReportedAsNotFound() {
        // given
        UUID source = source("roster-system");

        // when / then
        assertThatThrownBy(() -> references.unlink(source, "4711"))
                .isInstanceOf(ExternalReferenceNotFoundException.class);
    }

    @Test
    void givenAPersonThisInstanceDoesNotHold_whenLinking_thenItIsReportedAsNotFound() {
        // given
        UUID source = source("roster-system");
        UUID nobody = UUID.randomUUID();

        // when / then
        assertThatThrownBy(() -> references.link(source, "4711", nobody))
                .isInstanceOf(LinkedPersonNotFoundException.class);
    }

    @Test
    void givenNoSuchSource_whenLinking_thenItIsReportedAsNotFound() {
        // given
        UUID jane = person("Jane", "Doe");

        // when / then
        assertThatThrownBy(() -> references.link(UUID.randomUUID(), "4711", jane))
                .isInstanceOf(ImportSourceNotFoundException.class);
    }

    @Test
    void givenASourceARecordIsLinkedFrom_whenDeletingIt_thenItIsRefusedRatherThanTakingTheLinkWithIt() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");
        references.link(source, "4711", jane);

        // when / then
        assertThatThrownBy(() -> sources.delete(source))
                .isInstanceOf(ImportSourceInUseException.class);
        assertThat(personIdsOf(source)).isEqualTo(Map.of("4711", jane));
    }

    private Map<String, UUID> personIdsOf(UUID sourceId) {
        return references.list(sourceId, null, 50).items().stream()
                .collect(Collectors.toMap(ExternalLink::externalId, ExternalLink::personId));
    }

    private UUID source(String sourceKey) {
        return sources.create(sourceKey, "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(), 10).sourceId();
    }

    private UUID person(String firstName, String lastName) {
        return identities.createPerson(firstName, lastName);
    }
}
