package org.courtside.access.internal;

import org.courtside.access.CheckOutcome;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LoxoneRecordedFixtureTest extends LoxoneTestSupport {

    private static final String DEVICE_CODE = "73519246";
    private static final List<String> STEPS = List.of("probe", "connection-check", "getip", "api-key", "local-time",
            "user-create", "user-code", "user-edit", "user-code-again", "user-duplicate", "user-duplicate-clear",
            "user-read", "user-delete", "user-list", "cleanup");
    private static final Set<String> UNRECORDED = Set.of("user-edit", "user-code-again", "user-duplicate-clear");

    @TempDir
    Path target;

    private LoxoneRecorder recorder;
    private DeviceGuard guard;
    private LoxoneSettings settings;
    private LoxoneClient client;
    private LoxoneAccessControl device;

    @BeforeEach
    void aDeviceRunAgainstTheSimulator() {
        recorder = new LoxoneRecorder(List.of(LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, LoxoneSimulator.SERIAL,
                DEVICE_CODE));
        guard = new DeviceGuard(recorder, recorder::created);
        settings = simulator.settingsBySerial(DEADLINE);
        client = new LoxoneClient(settings, LoxoneSimulator.clientTrust(), clock,
                LoxoneLogin.clientUuid("courtside-device-contract", settings.address()));
        client.tap(guard);
        device = new LoxoneAccessControl(settings, accessPoint -> Optional.empty(), client, clock);
        simulator.forgetRequests();
    }

    @AfterEach
    void closeTheDevice() {
        device.close();
    }

    @Test
    void givenTheSimulator_whenTheDeviceContractRuns_thenEveryStepIsRecordedCleanlyAndNoUserOfItsOwnRemains()
            throws IOException {
        // when
        LoxoneDeviceContract.Observed observed = contract().run();
        recorder.write(target);

        // then
        try (Stream<Path> files = Files.list(target)) {
            assertThat(files.map(file -> file.getFileName().toString().replace(".json", "")))
                    .containsExactlyInAnyOrderElementsOf(STEPS);
        }
        assertThat(RecordedFixtures.violations(target)).as("only placeholders and known values survive").isEmpty();
        assertThat(observed.leftOver()).as("the run lists none of its own users at its end").isEmpty();
        assertThat(ownUsersOnTheSimulator()).isEmpty();
        assertThat(observed.code()).isEqualTo(200);
        assertThat(observed.edit()).as("the simulator edits its own user by uuid").isEqualTo(200);
        assertThat(observed.resentCode()).as("the simulator accepts a code again from the user holding it")
                .isEqualTo(200);
        assertThat(observed.clearedCode()).as("the simulator clears a code after its 201").isEqualTo(200);
        assertThat(observed.clearedRead()).isEqualTo(200);
        assertThat(observed.clearedKeycodes()).as("the cleared user holds no code").isZero();
        assertThat(observed.duplicateCode()).as("the simulator answers a code another user holds with 201")
                .isEqualTo(201);
        assertThat(observed.checks()).extracting(ConnectionCheckRun.Checked::check).contains("miniserver", "login");
        assertThat(observed.checks().getFirst().result().outcome()).isEqualTo(CheckOutcome.PASSED);
        assertThat(simulator.clientUuids()).as("the run never takes the production instance's token")
                .doesNotContain(LoxoneLogin.clientUuid(settings.address(), settings.instance()));
        assertThat(simulator.requests()).filteredOn(LoxoneSimulator.Request::mutating)
                .allSatisfy(request -> assertThat(request.command())
                        .isIn("addoredituser", "deleteuser", "updateuseraccesscode"));
    }

    @Test
    void givenTheRecordedDeviceRun_whenTheSameStepsRunAgainstTheSimulator_thenEveryStepAnswersAlike() {
        // when
        contract().run();
        device.close();
        recorder.write(target);

        // then
        assertThat(RecordedFixtures.differences(RecordedFixtures.RECORDED, target))
                .as("the simulator answers each recorded step as the Miniserver did").isEmpty();
    }

    @Test
    void givenTheRecording_whenItsStepsAreListed_thenOnlyTheStepsAwaitingTheNextDeviceRunAreMissing() {
        // when
        List<String> missing = STEPS.stream()
                .filter(step -> !Files.exists(RecordedFixtures.RECORDED.resolve(step + ".json"))).toList();

        // then
        assertThat(missing).as("a step the device run has since recorded leaves UNRECORDED, and every other step "
                + "is recorded").containsExactlyInAnyOrderElementsOf(UNRECORDED);
    }

    @Test
    void givenAPlantedDifferenceInACopyOfTheRecording_whenCompared_thenTheStepAndKeyPathAreNamedButNotTheValue()
            throws IOException {
        // given
        Path copy = Files.createDirectories(target.resolve("copy"));
        try (Stream<Path> files = Files.list(RecordedFixtures.RECORDED)) {
            for (Path file : files.toList()) {
                Files.copy(file, copy.resolve(file.getFileName()));
            }
        }
        Path apiKey = copy.resolve("api-key.json");
        Files.writeString(apiKey, Files.readString(apiKey).replace("'version':'17.0.3.31'", "'version':'17.0.3.30'"));

        // when
        List<String> differences = RecordedFixtures.differences(RecordedFixtures.RECORDED, copy);

        // then
        assertThat(differences).containsExactly("api-key $[0].response.LL.value.(single-quoted).version differs");
        assertThat(String.join(" ", differences)).doesNotContain("17.0.3");
    }

    @Test
    void givenAStepThatFails_whenTheContractRuns_thenTheFailureIsKeptAndItsUsersAreDeleted() {
        // given
        simulator.force("getuser", 500);

        // when / then
        assertThatThrownBy(() -> contract().run()).isInstanceOf(AssertionError.class)
                .hasMessage("getuser answered 500");
        assertThat(ownUsersOnTheSimulator()).as("cleanup deletes every user the run created").isEmpty();
        assertThat(simulator.count("deleteuser")).as("the probe user's own delete and one per user the run created")
                .isEqualTo(3);
    }

    @Test
    void givenTheGuard_whenAUserTheRunDoesNotOwnWouldBeDeleted_thenTheRequestNeverLeaves() {
        // given
        LoxoneAccessControl.listing(client.session());
        String member = simulator.usersNamed("jane.doe").getFirst().uuid;

        // when / then
        assertThatThrownBy(() -> client.session().changing("deleteuser", member)).isInstanceOf(AssertionError.class)
                .hasMessage("deleteuser names a user this run does not own");
        assertThat(simulator.count("deleteuser")).isZero();
    }

    @Test
    void givenTheGuard_whenAUserWouldJoinAGroup_thenTheRequestNeverLeaves() {
        // given
        String name = "courtside_device_0123456789abcdef";
        guard.issue(name);

        // when / then
        assertThatThrownBy(() -> client.session().changing("addoredituser", "{\"name\":\"" + name
                + "\",\"usergroups\":[\"" + simulator.groupUuid("Court 1") + "\"]}"))
                .isInstanceOf(AssertionError.class).hasMessage("addoredituser would assign a group");
        assertThat(simulator.count("addoredituser")).isZero();
    }

    @Test
    void givenTheGuard_whenAForeignNameOrAForeignUuidWouldBeEdited_thenTheRequestNeverLeaves() {
        // given
        LoxoneAccessControl.listing(client.session());
        String name = "courtside_device_0123456789abcdef";
        guard.issue(name);
        String member = simulator.usersNamed("jane.doe").getFirst().uuid;

        // when / then
        assertThatThrownBy(() -> client.session().changing("addoredituser", "{\"name\":\"jane.doe\"}"))
                .isInstanceOf(AssertionError.class).hasMessage("addoredituser names a user this run does not own");
        assertThatThrownBy(() -> client.session().changing("addoredituser", "{\"uuid\":\"" + member
                + "\",\"name\":\"" + name + "\"}"))
                .isInstanceOf(AssertionError.class).hasMessage("addoredituser edits a user this run does not own");
        assertThatThrownBy(() -> client.session().changing("addoredituser", "not a user"))
                .isInstanceOf(AssertionError.class).hasMessage("addoredituser carries no user");
        assertThat(simulator.count("addoredituser")).isZero();
    }

    @Test
    void givenTheGuard_whenACommandOutsideTheRunWouldBeSent_thenItNeverLeaves() {
        // when / then
        assertThatThrownBy(() -> client.session().changing("assignusertogroup", "x", "y"))
                .isInstanceOf(AssertionError.class).hasMessage("a device run never sends assignusertogroup");
        assertThat(simulator.count("assignusertogroup")).isZero();
    }

    @Test
    void givenANameOfTheGrantPattern_whenTheGuardIssuesIt_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> guard.issue(LoxoneSimulator.nameOf(UUID.randomUUID())))
                .isInstanceOf(AssertionError.class).hasMessage("a device run issues only names of its own pattern");
    }

    private LoxoneDeviceContract contract() {
        return new LoxoneDeviceContract(device, client, settings, clock, recorder, guard, DEVICE_CODE);
    }

    private List<LoxoneSimulator.User> ownUsersOnTheSimulator() {
        return simulator.requests().stream().filter(request -> request.command().equals("addoredituser"))
                .flatMap(request -> RecordedFixtures.embedded(request.arguments().getFirst()).stream())
                .map(user -> user.path("name").asString(""))
                .flatMap(name -> simulator.usersNamed(name).stream()).toList();
    }
}
