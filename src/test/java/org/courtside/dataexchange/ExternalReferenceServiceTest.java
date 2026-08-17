package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExternalReferenceServiceTest extends AbstractIntegrationTest {

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private PersonRepository persons;

    @Test
    void whenARecordIsLinkedToAPerson_thenThatPersonAnswersForItsExternalId() {
        // given
        UUID source = source("roster-system");
        UUID jane = person("Jane", "Doe");

        // when
        references.link(source, "4711", jane);

        // then
        assertThat(references.personIdsByExternalId(source, Set.of("4711", "4712")))
                .isEqualTo(Map.of("4711", jane));
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
        assertThat(references.personIdsByExternalId(first, Set.of("4711"))).isEqualTo(Map.of("4711", jane));
        assertThat(references.personIdsByExternalId(second, Set.of("A-90"))).isEqualTo(Map.of("A-90", jane));
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
        assertThat(references.personIdsByExternalId(source, Set.of("4711"))).isEqualTo(Map.of("4711", jane));
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
        assertThat(references.personIdsByExternalId(source, Set.of("4711"))).isEmpty();
        assertThat(persons.findById(jane)).isPresent();
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
        assertThat(references.personIdsByExternalId(source, Set.of("4711"))).isEqualTo(Map.of("4711", jane));
    }

    @Test
    void whenLookingUpNoExternalIdAtAll_thenTheDatabaseIsNotAsked() {
        // given
        UUID source = source("roster-system");

        // when / then
        assertThat(references.personIdsByExternalId(source, Set.of())).isEmpty();
    }

    private UUID source(String sourceKey) {
        return sources.create(sourceKey, "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME),
                Map.of(), Set.of(), 10).sourceId();
    }

    private UUID person(String firstName, String lastName) {
        return persons.save(new Person(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org")).getId();
    }
}
