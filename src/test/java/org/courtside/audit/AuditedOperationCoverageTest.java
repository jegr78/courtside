package org.courtside.audit;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.stream.Collectors;
import java.util.stream.Stream;

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
            "CardService#activeCards",
            "CardService#activeParticipantCards",
            "CardService#allCards",
            "CardService#allParticipantCards",
            "CardService#bookableCards",
            "CardService#changeCard",
            "CardService#changeParticipantCard",
            "CardService#createCard",
            "CardService#createParticipantCard",
            "CardService#findCard",
            "CardService#findParticipantCard",
            "CardService#lockParticipantCards",
            "CardService#requireCard",
            "CardService#requireParticipantCard",
            "CardService#setCardActive",
            "CardService#setParticipantCardActive",
            "ConfigService#clubName",
            "ConfigService#current",
            "ConfigService#defaultLocale",
            "ConfigService#deleteLogo",
            "ConfigService#leadTime",
            "ConfigService#lock",
            "ConfigService#logo",
            "ConfigService#slotDuration",
            "ConfigService#update",
            "ConfigService#uploadLogo",
            "ConfigService#validFor",
            "ConfigService#zoneId",
            "FacilityService#activeCourts",
            "FacilityService#allCourts",
            "FacilityService#allOpeningHours",
            "FacilityService#changeCourt",
            "FacilityService#closeOn",
            "FacilityService#createCourt",
            "FacilityService#findCourt",
            "FacilityService#findUnbookableCourts",
            "FacilityService#openingHoursFor",
            "FacilityService#requireBookableCourts",
            "FacilityService#requireCourt",
            "FacilityService#setCourtActive",
            "FacilityService#setOpeningHours",
            "FacilityService#weeklyOpeningHours",
            "MemberService#activeMembershipTypeIds",
            "MemberService#allMembershipTypes",
            "MemberService#changeMembershipType",
            "MemberService#createMembershipType",
            "MemberService#findParticipants",
            "MemberService#knowsMembershipType",
            "MemberService#membershipTypeIdOf",
            "MemberService#membershipTypeIdsGrantingAnAccount",
            "MemberService#membershipTypeNameOf",
            "MemberService#requireMembershipType",
            "MemberService#setMembershipTypeActive",
            "RosterService#changePerson",
            "RosterService#changeRoles",
            "RosterService#changeLocale",
            "RosterService#changeUsername",
            "RosterService#correctPerson",
            "RosterService#createAccount",
            "RosterService#createPerson",
            "RosterService#endMembership",
            "RosterService#list",
            "RosterService#person",
            "RosterService#personIdsHoldingAnAccount",
            "RosterService#requestCredentials",
            "RosterService#setAccountEnabled",
            "RosterService#writeMembership",
            "RosterSyncService#apply",
            "RuleAdminService#allRuleSets",
            "RuleAdminService#changeRuleSet",
            "RuleAdminService#createRuleSet",
            "RuleAdminService#removeRule",
            "RuleAdminService#requireRuleSet",
            "RuleAdminService#rulesOf",
            "RuleAdminService#setRule",
            "RuleAdminService#setRuleSetActive");

    @Test
    void givenAWriteOperation_whenItIsNotInTheInventory_thenTheBuildSaysSo() {
        // given
        Properties inventory = inventory();

        // when
        List<String> operations = declaredOperations();

        // then
        assertThat(operations).as(
                        "A log that misses an operation is worse than none, because it is believed. "
                                + "Add the operation to " + INVENTORY + " with its event type, or with "
                                + "'none' if it deliberately records nothing.")
                .allMatch(inventory::containsKey);
    }

    @Test
    void givenTheOperationDiscovery_whenItScansTheSevenServices_thenItFindsExactlyTheKnownOperations() {
        // given / when
        List<String> operations = declaredOperations();

        // then
        assertThat(operations).as(
                        "A public method was added, renamed or removed on one of the seven services. "
                                + "Update KNOWN_OPERATIONS to match, and give the method its own line in "
                                + INVENTORY + " naming its event type, or 'none' if it deliberately "
                                + "records nothing.")
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

    @Test
    void givenTheSevenServices_whenCheckingTheirSuperclass_thenNoneExtendsAnythingButObject() {
        // given / when
        List<String> withSuperclass = SERVICES.stream()
                .map(AuditedOperationCoverageTest::loadClass)
                .filter(service -> service.getSuperclass() != Object.class)
                .map(Class::getSimpleName)
                .toList();

        // then
        assertThat(withSuperclass).as(
                        "Discovery reads getDeclaredMethods(), which only sees a class's own methods, not "
                                + "what it inherits. A service that now extends something else can carry a "
                                + "public write method this coverage test never notices. Either widen "
                                + "declaredOperations() to include inherited public methods (filtering out "
                                + "Object's own), or add the new superclass here once it is deliberate.")
                .isEmpty();
    }

    @Test
    void givenTwoPublicMethods_whenTheyShareANameOnTheSameService_thenTheBuildSaysSo() {
        // given / when
        List<String> duplicates = duplicateMethodNames();

        // then
        assertThat(duplicates).as(
                        "The inventory key is Service#methodName. Two public methods sharing a name "
                                + "on the same service would collapse into that one key, and a write hidden "
                                + "inside whichever overload discovery does not see would never reach "
                                + INVENTORY + ". Give the methods different names, or widen the key to "
                                + "include the signature and rewrite every line in " + INVENTORY
                                + " to match.")
                .isEmpty();
    }

    private static List<String> duplicateMethodNames() {
        return SERVICES.stream()
                .map(AuditedOperationCoverageTest::loadClass)
                .flatMap(AuditedOperationCoverageTest::duplicateNamesOn)
                .sorted()
                .toList();
    }

    private static Stream<String> duplicateNamesOn(Class<?> service) {
        return Arrays.stream(service.getDeclaredMethods())
                .filter(method -> Modifier.isPublic(method.getModifiers()))
                .collect(Collectors.groupingBy(Method::getName, Collectors.counting()))
                .entrySet().stream()
                .filter(entry -> entry.getValue() > 1)
                .map(entry -> service.getSimpleName() + "#" + entry.getKey());
    }

    private static List<String> declaredOperations() {
        return SERVICES.stream()
                .map(AuditedOperationCoverageTest::loadClass)
                .flatMap(service -> Arrays.stream(service.getDeclaredMethods())
                        .filter(method -> Modifier.isPublic(method.getModifiers()))
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
