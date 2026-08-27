import { GenericContainer } from "testcontainers";

const JOURNEY_LABEL = "org.courtside.e2e.journey-id";
const RESOURCE_LABEL = "org.courtside.e2e.resource";
const STARTUP_LABEL = "org.courtside.e2e.startup-id";

export type BrowserStartupFailureClass = "port-publication" | "wait-strategy" | "docker-api" | "unknown";
export type DockerLifecycleCommand = (args: string[]) => Promise<string>;

export class ObservableGenericContainer extends GenericContainer {
  constructor(image: string, private readonly created: (containerId: string) => void) {
    super(image);
  }

  protected override containerCreated(containerId: string): Promise<void> {
    this.created(containerId);
    return Promise.resolve();
  }
}

export function browserContainerLabels(journeyId: string, startupId: string): Record<string, string> {
  return { [JOURNEY_LABEL]: journeyId, [RESOURCE_LABEL]: "browser", [STARTUP_LABEL]: startupId };
}

export function browserStartupFailureClass(error: unknown): BrowserStartupFailureClass {
  if (!(error instanceof Error)) return "unknown";
  if (/ports? to be bound|ports? exposed/i.test(error.message)) return "port-publication";
  if (/wait strategy|log message/i.test(error.message)) return "wait-strategy";
  if (/docker/i.test(error.name) || /(?:connect|socket|container).*(?:ENOENT|ECONN|API)/i.test(error.message)) {
    return "docker-api";
  }
  return "unknown";
}

export async function startOwnedBrowserContainer<T>(
  start: (created: (containerId: string) => void) => Promise<T>,
  discover: () => Promise<string[]>,
  diagnose: (containerId: string, failureClass: BrowserStartupFailureClass) => Promise<unknown>,
  remove: (containerId: string) => Promise<unknown>
): Promise<T> {
  let containerId: string | undefined;
  try {
    return await start((createdId) => { containerId = createdId; });
  } catch (startupFailure) {
    const cleanupFailures: unknown[] = [];
    let containerIds: string[] = [];
    try {
      containerIds = containerId === undefined ? await discover() : [containerId];
    } catch (error) {
      cleanupFailures.push(error);
    }
    for (const ownedContainerId of containerIds) {
      try {
        await diagnose(ownedContainerId, browserStartupFailureClass(startupFailure));
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        await remove(ownedContainerId);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError([startupFailure, ...cleanupFailures], "Browser startup and cleanup failed",
        { cause: startupFailure });
    }
    throw startupFailure;
  }
}

export async function ownedBrowserContainerIds(journeyId: string, networkId: string | undefined,
  docker: DockerLifecycleCommand, startupId?: string): Promise<string[]> {
  const filters = ["ps", "-aq"];
  if (networkId !== undefined) filters.push("--filter", `network=${networkId}`);
  filters.push("--filter", `label=${JOURNEY_LABEL}=${journeyId}`,
    "--filter", `label=${RESOURCE_LABEL}=browser`);
  if (startupId !== undefined) filters.push("--filter", `label=${STARTUP_LABEL}=${startupId}`);
  const listed = await docker(filters);
  const containerIds = listed.split("\n").map((value) => value.trim()).filter(Boolean);
  for (const containerId of containerIds) {
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw new Error("Docker returned an invalid browser container ID");
    const labels = JSON.parse(await docker(["inspect", "--format", "{{json .Config.Labels}}", containerId])) as
      Record<string, unknown>;
    if (labels[JOURNEY_LABEL] !== journeyId || labels[RESOURCE_LABEL] !== "browser") {
      throw new Error(`Browser container ${containerId} ownership changed before cleanup`);
    }
    if (startupId !== undefined && labels[STARTUP_LABEL] !== startupId) {
      throw new Error(`Browser container ${containerId} startup ownership changed before cleanup`);
    }
  }
  return containerIds;
}

export async function removeOwnedBrowserContainers(journeyId: string, networkId: string,
  docker: DockerLifecycleCommand): Promise<void> {
  const containerIds = await ownedBrowserContainerIds(journeyId, networkId, docker);
  const failures: unknown[] = [];
  for (const containerId of containerIds) {
    try {
      await docker(["rm", "-f", containerId]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Browser container cleanup failed");
}
