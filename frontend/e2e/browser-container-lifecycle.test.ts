import { describe, expect, it, vi } from "vitest";
import {
  browserStartupFailureClass,
  ownedBrowserContainerIds,
  removeOwnedBrowserContainers,
  startOwnedBrowserContainer
} from "./browser-container-lifecycle";

describe("browser container lifecycle", () => {
  it("given startup fails before port publication, when the container was created, then it is diagnosed and removed", async () => {
    // given
    const attached = new Set<string>();
    const diagnose = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn((containerId: string) => {
      attached.delete(containerId);
      return Promise.resolve();
    });
    const start = vi.fn((created: (containerId: string) => void) => {
      created("a".repeat(64));
      attached.add("a".repeat(64));
      return Promise.reject(new Error("Timed out after 10000ms while waiting for container ports to be bound"));
    });

    // when / then
    await expect(startOwnedBrowserContainer(start, () => Promise.resolve([]), diagnose, remove))
      .rejects.toThrow(/ports to be bound/);
    expect(diagnose).toHaveBeenCalledWith("a".repeat(64), "port-publication");
    expect(remove).toHaveBeenCalledWith("a".repeat(64));
    expect(attached).toEqual(new Set());
  });

  it("given startup fails before the created callback, when the attempt label exists, then the exact container is recovered", async () => {
    // given
    const containerId = "e".repeat(64);
    const discover = vi.fn().mockResolvedValue([containerId]);
    const diagnose = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockRejectedValue(new Error("copy archive failed"));

    // when / then
    await expect(startOwnedBrowserContainer(start, discover, diagnose, remove)).rejects.toThrow("copy archive failed");
    expect(discover).toHaveBeenCalledOnce();
    expect(diagnose).toHaveBeenCalledWith(containerId, "unknown");
    expect(remove).toHaveBeenCalledWith(containerId);
  });

  it("given startup diagnosis fails, when rolling back the container, then removal still runs and both failures remain", async () => {
    // given
    const containerId = "9".repeat(64);
    const diagnose = vi.fn().mockRejectedValue(new Error("diagnostics unavailable"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn((created: (value: string) => void) => {
      created(containerId);
      return Promise.reject(new Error("browser did not start"));
    });

    // when / then
    await expect(startOwnedBrowserContainer(start, () => Promise.resolve([]), diagnose, remove))
      .rejects.toMatchObject({
        message: "Browser startup and cleanup failed",
        errors: [expect.objectContaining({ message: "browser did not start" }),
          expect.objectContaining({ message: "diagnostics unavailable" })]
      });
    expect(remove).toHaveBeenCalledWith(containerId);
  });

  it("given immediate cleanup fails, when global teardown inventories the network, then the owned container cannot block it", async () => {
    // given
    const containerId = "b".repeat(64);
    const attached = new Set([containerId]);
    const docker = vi.fn((args: string[]) => {
      if (args[0] === "ps") return Promise.resolve(`${[...attached].join("\n")}\n`);
      if (args[0] === "inspect") return Promise.resolve(JSON.stringify({
        "org.courtside.e2e.journey-id": "journey-1",
        "org.courtside.e2e.resource": "browser",
        "org.courtside.e2e.startup-id": "startup-1"
      }));
      if (args[0] === "rm") {
        attached.delete(args[2]);
        return Promise.resolve("");
      }
      return Promise.reject(new Error("Unexpected Docker command"));
    });
    const stopNetwork = vi.fn(() => attached.size === 0
      ? Promise.resolve() : Promise.reject(new Error("network has active endpoints")));

    // when
    await removeOwnedBrowserContainers("journey-1", "network-1", docker);
    await stopNetwork();

    // then
    expect(attached).toEqual(new Set());
    expect(stopNetwork).toHaveBeenCalledOnce();
    expect(docker).toHaveBeenCalledWith(["ps", "-aq", "--filter", "network=network-1",
      "--filter", "label=org.courtside.e2e.journey-id=journey-1",
      "--filter", "label=org.courtside.e2e.resource=browser"]);
    expect(docker).toHaveBeenCalledWith(["rm", "-f", containerId]);
  });

  it("given inventory returns a container with different ownership, when cleanup runs, then it fails closed", async () => {
    // given
    const containerId = "c".repeat(64);
    const docker = vi.fn((args: string[]) => Promise.resolve(args[0] === "ps" ? `${containerId}\n` : JSON.stringify({
      "org.courtside.e2e.journey-id": "another-journey",
      "org.courtside.e2e.resource": "browser"
    })));

    // when / then
    await expect(removeOwnedBrowserContainers("journey-1", "network-1", docker))
      .rejects.toThrow(/ownership changed/);
    expect(docker).not.toHaveBeenCalledWith(["rm", "-f", containerId]);
  });

  it("given startup recovery sees another attempt, when discovering the container, then it fails closed", async () => {
    // given
    const containerId = "f".repeat(64);
    const docker = vi.fn((args: string[]) => Promise.resolve(args[0] === "ps" ? `${containerId}\n` : JSON.stringify({
      "org.courtside.e2e.journey-id": "journey-1",
      "org.courtside.e2e.resource": "browser",
      "org.courtside.e2e.startup-id": "startup-2"
    })));

    // when / then
    await expect(ownedBrowserContainerIds("journey-1", "network-1", docker, "startup-1"))
      .rejects.toThrow(/startup ownership changed/);
    expect(docker).toHaveBeenCalledWith(["ps", "-aq", "--filter", "network=network-1",
      "--filter", "label=org.courtside.e2e.journey-id=journey-1",
      "--filter", "label=org.courtside.e2e.resource=browser",
      "--filter", "label=org.courtside.e2e.startup-id=startup-1"]);
  });

  it("given a container was created before network attachment, when recovering the startup, then labels still find it", async () => {
    // given
    const containerId = "1".repeat(64);
    const docker = vi.fn((args: string[]) => Promise.resolve(args[0] === "ps" ? `${containerId}\n` : JSON.stringify({
      "org.courtside.e2e.journey-id": "journey-1",
      "org.courtside.e2e.resource": "browser",
      "org.courtside.e2e.startup-id": "startup-1"
    })));

    // when
    const found = await ownedBrowserContainerIds("journey-1", undefined, docker, "startup-1");

    // then
    expect(found).toEqual([containerId]);
    expect(docker).toHaveBeenCalledWith(["ps", "-aq",
      "--filter", "label=org.courtside.e2e.journey-id=journey-1",
      "--filter", "label=org.courtside.e2e.resource=browser",
      "--filter", "label=org.courtside.e2e.startup-id=startup-1"]);
  });

  it("given removing one owned container fails, when cleaning up, then every other container is still removed", async () => {
    // given
    const first = "2".repeat(64);
    const second = "3".repeat(64);
    const docker = vi.fn((args: string[]) => {
      if (args[0] === "ps") return Promise.resolve(`${first}\n${second}\n`);
      if (args[0] === "inspect") return Promise.resolve(JSON.stringify({
        "org.courtside.e2e.journey-id": "journey-1",
        "org.courtside.e2e.resource": "browser"
      }));
      if (args[0] === "rm" && args[2] === first) return Promise.reject(new Error("first removal failed"));
      return Promise.resolve("");
    });

    // when / then
    await expect(removeOwnedBrowserContainers("journey-1", "network-1", docker)).rejects.toMatchObject({
      message: "Browser container cleanup failed",
      errors: [expect.objectContaining({ message: "first removal failed" })]
    });
    expect(docker).toHaveBeenCalledWith(["rm", "-f", first]);
    expect(docker).toHaveBeenCalledWith(["rm", "-f", second]);
  });

  it.each([
    [new Error("Timed out after 10000ms while waiting for container ports to be bound"), "port-publication"],
    [new Error("Log message not received"), "wait-strategy"],
    [Object.assign(new Error("connect ENOENT"), { name: "DockerError" }), "docker-api"],
    [new Error("unexpected failure"), "unknown"]
  ])("given a startup error, when classifying it, then only the bounded class is retained", (failure, expected) => {
    // given / when / then
    expect(browserStartupFailureClass(failure)).toBe(expected);
  });
});
