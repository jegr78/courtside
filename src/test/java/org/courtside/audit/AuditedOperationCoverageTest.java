package org.courtside.audit;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

class AuditedOperationCoverageTest {

    private static final String INVENTORY = "audited-operations.properties";
    private static final String NONE = "none";

    private static final List<String> SERVICES = List.of(
            "org.courtside.facility.FacilityService",
            "org.courtside.card.CardService",
            "org.courtside.config.internal.ConfigService",
            "org.courtside.rules.internal.RuleAdminService",
            "org.courtside.member.MemberService",
            "org.courtside.member.RosterService",
            "org.courtside.member.RosterSyncService");

    private static final List<String> KNOWN_OPERATIONS = List.of(
            "CardService#changeCard",
            "CardService#changeParticipantCard",
            "CardService#createCard",
            "CardService#createParticipantCard",
            "CardService#setCardActive",
            "CardService#setParticipantCardActive",
            "ConfigService#update",
            "FacilityService#changeCourt",
            "FacilityService#closeOn",
            "FacilityService#createCourt",
            "FacilityService#setCourtActive",
            "FacilityService#setOpeningHours",
            "MemberService#changeMembershipType",
            "MemberService#createMembershipType",
            "MemberService#setMembershipTypeActive",
            "RosterService#changePerson",
            "RosterService#changeRoles",
            "RosterService#changeUsername",
            "RosterService#correctPerson",
            "RosterService#createAccount",
            "RosterService#createPerson",
            "RosterService#endMembership",
            "RosterService#resetPassword",
            "RosterService#setAccountEnabled",
            "RosterService#writeMembership",
            "RosterSyncService#apply",
            "RuleAdminService#changeRuleSet",
            "RuleAdminService#createRuleSet",
            "RuleAdminService#removeRule",
            "RuleAdminService#setRule",
            "RuleAdminService#setRuleSetActive");

    @Test
    void givenAWriteOperation_whenItIsNotInTheInventory_thenTheBuildSaysSo() {
        // given
        Properties inventory = inventory();

        // when
        List<String> operations = writeOperations();

        // then
        assertThat(operations).as(
                        "A log that misses an operation is worse than none, because it is believed. "
                                + "Add the operation to " + INVENTORY + " with its event type, or with "
                                + "'none' if it deliberately records nothing.")
                .allMatch(inventory::containsKey);
    }

    @Test
    void givenTheOperationDiscovery_whenItScansTheSevenServices_thenItFindsExactlyTheKnownWriteOperations() {
        // given / when
        List<String> operations = writeOperations();

        // then
        assertThat(operations).as(
                        "Discovery reads method-level @Transactional only. If this list shrinks below "
                                + "the known write operations, some method now relies on its class's own "
                                + "@Transactional instead of declaring one, and the coverage test above "
                                + "would go blind to it while staying green.")
                .containsExactlyInAnyOrderElementsOf(KNOWN_OPERATIONS);
    }

    @Test
    void givenAnInventoryEntry_whenItNamesEventTypes_thenEveryOneOfThemIsPublishedSomewhere() {
        // given
        Properties inventory = inventory();
        List<String> published = List.copyOf(DomainEventPayloadTest.publishedTypes());

        // when
        List<String> declared = inventory.stringPropertyNames().stream()
                .map(inventory::getProperty)
                .flatMap(value -> Arrays.stream(value.split(",")))
                .filter(type -> !NONE.equals(type))
                .distinct()
                .toList();

        // then
        assertThat(published).as(
                        "A typo in " + INVENTORY + " would otherwise be believed instead of caught. "
                                + "Every event type it names must be a TYPE constant some DomainEventRecord "
                                + "actually declares.")
                .containsAll(declared);
    }

    private static List<String> writeOperations() {
        return SERVICES.stream()
                .map(AuditedOperationCoverageTest::loadClass)
                .flatMap(service -> Arrays.stream(service.getDeclaredMethods())
                        .filter(method -> Modifier.isPublic(method.getModifiers()))
                        .filter(method -> method.isAnnotationPresent(Transactional.class))
                        .map(method -> service.getSimpleName() + "#" + method.getName()))
                .distinct()
                .sorted()
                .toList();
    }

    private static Class<?> loadClass(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Cannot load " + name, e);
        }
    }

    private static Properties inventory() {
        Properties properties = new Properties();
        try (InputStream source = new ClassPathResource(INVENTORY).getInputStream()) {
            properties.load(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + INVENTORY, e);
        }
        return properties;
    }
}
