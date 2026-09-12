import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { authorizationActors, buildOperationAuthorizationMatrix } from "./security-authorization.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const YAML = require("yaml");
const repository = fileURLToPath(new URL("..", import.meta.url));
const architecture = JSON.parse(readFileSync(new URL(
  "../security/production-architecture.json", import.meta.url), "utf8"));
const architectureSchema = JSON.parse(readFileSync(new URL(
  "../security/production-architecture.schema.json", import.meta.url), "utf8"));
const workflows = JSON.parse(readFileSync(new URL(
  "../security/production-workflows.json", import.meta.url), "utf8"));
const workflowSchema = JSON.parse(readFileSync(new URL(
  "../security/production-workflows.schema.json", import.meta.url), "utf8"));
const resourceDemand = JSON.parse(readFileSync(new URL(
  "../security/resource-demand-inventory.json", import.meta.url), "utf8"));
const composeSource = "deploy/compose.yaml";
const compose = YAML.parse(readFileSync(`${repository}/${composeSource}`, "utf8"));
const composeFiles = [composeSource, ...compose["x-courtside-production-overlays"]
  .map((path) => `deploy/${path}`)];
const composeDocuments = composeFiles.map((path) => ({ path, document: YAML.parse(
  readFileSync(`${repository}/${path}`, "utf8").replaceAll("!reset null", "null")) }));
const openapi = YAML.parse(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
const applicationConfigurations = productionApplicationConfigurations();
const caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
const deploymentDocumentation = readFileSync(new URL("../deploy/README.md", import.meta.url), "utf8");
const mailPlan = readFileSync(new URL("../deploy/mail/base.ndjson", import.meta.url), "utf8")
  .split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));

const networkApiPatterns = [
  /(?:^import |\b)java\.net\./m,
  /(?:^import |\b)java\.nio\.channels\./m,
  /(?:^import |\b)javax\.naming\./m,
  /(?:^import |\b)jakarta\.mail\./m,
  /(?:^import |\b)io\.grpc\./m,
  /^import org\.springframework\.integration\./m,
  /^import org\.springframework\.mail\./m,
  /^import org\.springframework\.web\.(?:client|reactive\.function\.client)\./m,
  /^import (?:com\.azure|com\.google\.cloud|okhttp3|org\.apache\.hc\.client5|retrofit2|software\.amazon\.awssdk)\./m,
  /\b(?:curl|wget|nc|nslookup|dig)\b/,
  /open(?:ssl)\s+s_client/,
  /(?:from|require\s*\()\s*["']node:(?:dns|http|https|net|tls)/,
  /\bfetch\s*\(/
];
const outboundApiPatterns = [
  /^import java\.net\.http\.HttpClient;/m,
  /^import java\.net\.HttpURLConnection;/m,
  /^import java\.net\.(?:DatagramSocket|ServerSocket|Socket);/m,
  /^import java\.nio\.channels\.(?:AsynchronousSocketChannel|SocketChannel);/m,
  /^import jakarta\.mail\.Transport;/m,
  /^import org\.springframework\.mail\.javamail\.JavaMailSender;/m,
  /^import org\.springframework\.web\.client\.(?:RestClient|RestTemplate);/m,
  /^import org\.springframework\.web\.reactive\.function\.client\.WebClient;/m,
  /^import (?:com\.azure|com\.google\.cloud|okhttp3|org\.apache\.hc\.client5|retrofit2|software\.amazon\.awssdk)\./m,
  /java\.net\.(?:DatagramSocket|ServerSocket|Socket)\s*\(/,
  /\.(?:openConnection|openStream)\s*\(/,
  /\b(?:curl|wget|nc|nslookup|dig)\b/,
  /open(?:ssl)\s+s_client/,
  /(?:from|require\s*\()\s*["']node:(?:dns|http|https|net|tls)/,
  /\bfetch\s*\(/
];
const outboundApiTokens = ["java.net.http.HttpClient."];

const serviceDefinitions = (service) => composeDocuments.flatMap(({ path, document }) =>
  document.services?.[service] ? [{ path, definition: document.services[service] }] : []);
const composeServices = () => [...new Set(composeDocuments
  .flatMap(({ document }) => Object.keys(document.services ?? {})))].toSorted();
const reviewedImages = (documents = composeDocuments) => {
  const images = new Map();
  for (const { path, document } of documents) {
    for (const [service, definition] of Object.entries(document.services ?? {})) {
      assert.equal(Object.hasOwn(definition, "build"), false,
        `${path}:${service} uses an unreviewed production build context`);
      if (definition.image) images.set(service, { service, image: definition.image });
    }
  }
  return [...images.values()].toSorted((left, right) => left.service.localeCompare(right.service));
};
const imageRegistry = (image) => {
  const separator = image.indexOf("/");
  if (separator < 0) return "docker.io";
  const first = image.slice(0, separator);
  return first === "localhost" || first.includes(".") || first.includes(":") ? first : "docker.io";
};
const publishedListeners = () => {
  const overlayPortDefinitions = composeDocuments.slice(1).flatMap(({ path, document }) =>
    Object.entries(document.services ?? {})
      .filter(([, definition]) => Object.hasOwn(definition, "ports"))
      .map(([service]) => `${path}:${service}`));
  assert.deepEqual(overlayPortDefinitions, [],
    "production overlays may not declare ports without a Compose-aware listener projection");
  return Object.entries(compose.services).flatMap(([service, definition]) =>
    (definition.ports ?? []).map((published) => ({ service, published })))
    .toSorted((left, right) => `${left.service}:${left.published}`.localeCompare(`${right.service}:${right.published}`));
};
const configuredMailListeners = () => mailPlan.filter(({ object }) => object === "NetworkListener")
  .flatMap(({ value }) => Object.values(value))
  .flatMap(({ name, bind }) => Object.keys(bind).map((address) => ({
    name, port: Number(address.slice(address.lastIndexOf(":") + 1))
  }))).toSorted((left, right) => left.port - right.port);
const configuredMailListenerReachability = (posture) => configuredMailListeners().map((listener) => {
  const internal = posture.filter(({ service, networks }) => service !== "mail"
    && networks.some((network) => posture.find((entry) => entry.service === "mail").networks.includes(network)))
    .map(({ service }) => service);
  const published = listener.port === 25 ? ["public-network"] : listener.port === 8080 ? ["operator"] : [];
  return { ...listener, reachableSources: [...internal, ...published].toSorted() };
});
const composeNetworkPosture = () => composeServices().map((service) => {
  const definitions = serviceDefinitions(service);
  if (definitions.some(({ definition }) => definition.network_mode === "none")) {
    assert.ok(definitions.every(({ definition }) => definition.networks == null),
      `${service} combines network_mode none with an overlay network`);
    return { service, mode: "none", networks: [] };
  }
  const explicit = definitions.filter(({ definition }) => definition.networks != null)
    .flatMap(({ definition }) => Array.isArray(definition.networks)
      ? definition.networks : Object.keys(definition.networks));
  return { service, mode: "attached", networks: [...new Set(explicit.length ? explicit : ["default"])].toSorted() };
}).toSorted((left, right) => left.service.localeCompare(right.service));
const composeNetworkSegments = (posture) => Object.entries(compose.networks ?? {}).map(([name, definition]) => ({
  name,
  internal: definition?.internal === true,
  members: posture.filter(({ networks }) => networks.includes(name)).map(({ service }) => service).toSorted(),
  egressGatewayFor: composeServices().filter((service) => serviceDefinitions(service)
    .some(({ definition }) => !Array.isArray(definition.networks)
      && definition.networks?.[name]?.gw_priority > 0)).toSorted()
})).toSorted((left, right) => left.name.localeCompare(right.name));
const sharedNetworks = (posture, left, right) => {
  const networks = new Map(posture.map((entry) => [entry.service, entry.networks]));
  return networks.get(left).filter((network) => networks.get(right).includes(network)).toSorted();
};
const operations = () => Object.values(openapi.paths).flatMap((path) => Object.values(path))
  .filter((operation) => operation?.operationId)
  .map(({ operationId }) => operationId).toSorted();
const browserDestinations = () => Object.entries(openapi.components.schemas)
  .flatMap(([schemaName, schema]) => destinationFields(schema, schemaName)).toSorted();
const destinationFields = (node, path) => {
  if (!node || typeof node !== "object") return [];
  const direct = Object.entries(node.properties ?? {}).flatMap(([name, property]) => [
    ...(name !== "type" && (property.format === "uri" || String(property.pattern ?? "").includes("https"))
      ? [`${path}.${name}`] : []),
    ...destinationFields(property, `${path}.${name}`)
  ]);
  return [...direct, ...(node.allOf ?? []).flatMap((part) => destinationFields(part, path))];
};
const productionJavaFiles = () => readdirSync(`${repository}/src/main/java`, { recursive: true })
  .filter((path) => path.endsWith(".java"))
  .map((path) => `src/main/java/${path.replaceAll("\\", "/")}`);
const productionScriptFiles = () => [...new Set([
  ...composeDocuments.flatMap(({ document }) => Object.values(document.services ?? {}))
    .flatMap((definition) => definition.volumes ?? [])
    .map((mount) => typeof mount === "string" ? mount.split(":")[0] : mount.source)
    .filter((source) => source?.startsWith("./"))
    .flatMap((source) => {
      const relativeSource = `deploy/${source.slice(2)}`;
      const absoluteSource = `${repository}/${relativeSource}`;
      if (!statSync(absoluteSource).isDirectory()) return [relativeSource];
      return readdirSync(absoluteSource, { recursive: true })
        .filter((path) => statSync(`${absoluteSource}/${path}`).isFile())
        .map((path) => `${relativeSource}/${path.replaceAll("\\", "/")}`);
    }),
  "tools/courtside.mail-smoke.mjs"
])].filter((path) => /\.(?:mjs|sh)$/.test(path)).toSorted();
const productionNetworkFiles = () => [...productionJavaFiles(), ...productionScriptFiles()];
const outboundClientFiles = () => productionNetworkFiles().filter((path) => {
  const source = readFileSync(`${repository}/${path}`, "utf8");
  return isNetworkClientSource(source);
}).toSorted();
const reviewedNetworkApiFiles = () => productionNetworkFiles().filter((path) => {
  const source = readFileSync(`${repository}/${path}`, "utf8");
  return networkApiPatterns.some((pattern) => pattern.test(source));
}).toSorted();
const isNetworkClientSource = (source) => outboundApiPatterns.some((pattern) => pattern.test(source))
  || outboundApiTokens.some((token) => source.includes(token));
const applicationNetworkTargets = (configurations) => {
  const flattened = configurations.flatMap(({ name, configuration }) =>
    flattenConfiguration(configuration).map((entry) => ({ ...entry, name })));
  const directTargets = flattened.filter(({ path, value }) => typeof value === "string"
    && /(?:^|-)(?:url|uri|endpoint|host)$/.test(path.at(-1)));
  const networkParents = new Set(directTargets.map(({ name, path }) => `${name}:${path.slice(0, -1).join(".")}`));
  return flattened.filter(({ name, path, value }) => directTargets
    .some((target) => target.name === name && target.path.join(".") === path.join("."))
      || (path.at(-1) === "port" && networkParents.has(`${name}:${path.slice(0, -1).join(".")}`)
        && typeof value === "string"))
    .map(({ name, path }) => `application:${name}:${path.join(".")}`);
};
const composeNetworkTargets = (environment) => {
  const directEnvironmentTargets = Object.keys(environment)
    .filter((key) => /(?:URL|URI|ENDPOINT|HOST)$/.test(key));
  const environmentPrefixes = new Set(directEnvironmentTargets
    .filter((key) => key.endsWith("HOST")).map((key) => key.slice(0, -4)));
  return Object.keys(environment)
    .filter((key) => directEnvironmentTargets.includes(key)
      || (key.endsWith("PORT") && environmentPrefixes.has(key.slice(0, -4))))
    .map((key) => `compose:app:${key}`);
};
const composeEnvironmentNames = () => [...new Set(composeDocuments.flatMap(({ document }) =>
  Object.entries(document.services ?? {}).flatMap(([service, definition]) =>
    Object.keys(definition.environment ?? {}).map((name) => `compose:${service}:${name}`))))].toSorted();
const configuredComposeServiceTargets = () => {
  const services = composeServices();
  return composeDocuments.flatMap(({ document }) => Object.entries(document.services ?? {})
    .flatMap(([source, definition]) => Object.entries(definition.environment ?? {}).flatMap(([name, value]) => {
      if (typeof value !== "string") return [];
      const target = services.find((service) => value === service
        || value.includes(`//${service}:`) || value.includes(`:-${service}}`));
      return target ? [{ configuredTarget: `compose:${source}:${name}`, source, target }] : [];
    })));
};
const configuredNetworkTargets = () => [
  ...applicationNetworkTargets(applicationConfigurations),
  ...composeDocuments.flatMap(({ document }) => Object.entries(document.services ?? {}).flatMap(([service, definition]) =>
    composeNetworkTargets(definition.environment ?? {})
      .map((target) => target.replace("compose:app:", `compose:${service}:`))))
].toSorted();
const flattenConfiguration = (node, path = []) => Object.entries(node ?? {}).flatMap(([key, value]) =>
  value && typeof value === "object"
    ? flattenConfiguration(value, [...path, key])
    : [{ path: [...path, key], value }]);
function productionApplicationConfigurations() {
  const resources = `${repository}/src/main/resources`;
  const environment = compose.services.app.environment ?? {};
  const selected = String(environment.SPRING_PROFILES_ACTIVE ?? "").split(",")
    .map((profile) => profile.trim()).filter(Boolean);
  if (selected.some((profile) => profile.includes("${"))) {
    throw new Error("A dynamic production Spring profile cannot be inventoried");
  }
  const names = ["application.yaml", ...selected.map((profile) => `application-${profile}.yaml`)];
  return names.map((name) => ({ name, configuration: YAML.parse(readFileSync(`${resources}/${name}`, "utf8")) }));
}
const effectiveComposeMounts = (documents = composeDocuments) => {
  const mounts = new Map();
  for (const { path, document } of documents) {
    for (const [service, definition] of Object.entries(document.services ?? {})) {
      for (const mount of definition.volumes ?? []) {
        const parsed = typeof mount === "string"
          ? mount.match(/^(?<source>.+):(?<target>\/[^:]+)(?::(?<options>[^:]+))?$/)?.groups
          : { source: mount.source, target: mount.target,
            options: mount.read_only === true ? "ro" : "", type: mount.type };
        assert.ok(parsed?.source && parsed.target, `${path}:${service} has an unparseable volume mount`);
        mounts.set(`${service}:${parsed.target}`, { service, source: parsed.source,
          target: parsed.target, readOnly: parsed.options?.split(",").includes("ro") ?? false,
          type: parsed.type, productionPath: path });
      }
    }
  }
  return [...mounts.values()];
};
const composeMountRelations = (documents = composeDocuments) => {
  const relations = [];
  const namedVolumes = new Set(documents.flatMap(({ document }) => Object.keys(document.volumes ?? {})));
  const mounts = effectiveComposeMounts(documents);
  const isNamedVolume = (mount) => mount.type === "volume"
    || (mount.type === undefined && namedVolumes.has(mount.source));
  for (const volume of namedVolumes) {
    const writers = mounts.filter((mount) => isNamedVolume(mount)
      && mount.source === volume && !mount.readOnly);
    const receivers = mounts.filter((mount) => isNamedVolume(mount) && mount.source === volume);
    for (const writer of writers) for (const receiver of receivers) {
      if (writer.service === receiver.service) continue;
      relations.push({ id: `compose-volume:${volume}:${writer.service}:${receiver.service}`,
        from: writer.service, to: receiver.service });
    }
  }
  for (const mount of mounts) {
    const { service, source, target, readOnly, productionPath } = mount;
    if (isNamedVolume(mount)) continue;
    assert.equal(readOnly, true,
      `${productionPath}:${service}:${target} has a writable operator-controlled bind mount`);
    const variable = source.match(/^\$\{(?<name>[A-Z_][A-Z0-9_]*)(?::[^}]*)?\}$/)?.groups.name;
    const sourceKind = variable ?? (source.startsWith("./") && !source.includes("$")
      ? "repository" : source.startsWith("/") && !source.includes("$") ? "absolute" : undefined);
    assert.ok(sourceKind, `${productionPath}:${service}:${target} has an unclassified bind source ${source}`);
    relations.push({ id: `compose-bind:${sourceKind}:operator:${service}:${target}`,
      from: "operator", to: service, productionPath });
  }
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()]
    .toSorted((left, right) => left.id.localeCompare(right.id));
};
const deploymentRelations = () => {
  const relations = composeMountRelations();
  for (const match of caddy.matchAll(/\breverse_proxy\s+(?:https?:\/\/)?([a-z][a-z0-9-]*):\d+/g)) {
    relations.push({ id: `caddy-upstream:proxy:${match[1]}`, from: "proxy", to: match[1] });
  }
  const hasMxRoute = mailPlan.filter(({ object }) => object === "MtaRoute")
    .flatMap(({ value }) => Object.values(value)).some((route) => route["@type"] === "Mx");
  if (hasMxRoute) {
    relations.push({ id: "mail-mx:mail:dns", from: "mail", to: "dns" });
    relations.push({ id: "mail-mx:mail:recipient-mail-system", from: "mail", to: "recipient-mail-system" });
  }
  for (const service of ["database-setup", "database-migrate"]) {
    if (serviceDefinitions(service).some(({ definition }) =>
      definition.environment?.SPRING_DATASOURCE_URL?.includes("//db:"))) {
      relations.push({ id: `configured-target:${service}:db`, from: service, to: "db" });
    }
  }
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()]
    .toSorted((left, right) => left.id.localeCompare(right.id));
};

test("given the production architecture, when validating it, then every claim satisfies the closed schema", () => {
  // given
  const validateArchitecture = new Ajv({ strict: true, allErrors: true }).compile(architectureSchema);
  const validateWorkflows = new Ajv({ strict: true, allErrors: true }).compile(workflowSchema);

  // when / then
  assert.equal(validateArchitecture(architecture), true, JSON.stringify(validateArchitecture.errors));
  assert.equal(validateWorkflows(workflows), true, JSON.stringify(validateWorkflows.errors));
  assert.deepEqual(architecture.sources.composeFiles, composeFiles);
  assert.deepEqual(architecture.sources.reviewedImages.map(({ service }) => service).toSorted(),
    reviewedImages().map(({ service }) => service),
    "every effective image must have a registry-boundary classification");
  assert.deepEqual(architecture.sources.reviewedImages.map(({ service }) => service).toSorted(),
    composeServices(), "every production service must acquire a reviewed image");
  for (const reviewed of architecture.sources.reviewedImages) {
    const image = reviewedImages().find(({ service }) => service === reviewed.service).image;
    const registry = imageRegistry(image);
    const registryComponent = new Map([
      ["docker.io", "docker-hub"],
      ["ghcr.io", "container-registry"]
    ]).get(registry);
    assert.ok(registryComponent, `${reviewed.service} uses unclassified image registry ${registry}`);
    const boundary = architecture.trustBoundaries.find(({ id }) => id === reviewed.boundaryId);
    assert.deepEqual({ from: boundary?.from, to: boundary?.to },
      { from: "operator", to: registryComponent },
      `${reviewed.service} image source is not classified`);
  }
  assert.equal(imageRegistry("postgres:17-alpine@sha256:" + "a".repeat(64)), "docker.io");
  assert.equal(imageRegistry("ghcr.io/example/image:1"), "ghcr.io");
  assert.equal(imageRegistry("quay.io/example/image:1"), "quay.io");
});

test("given the reference deployment, when components and published listeners change, then the architecture inventory fails closed", () => {
  // given
  const services = architecture.components.filter(({ source }) => source === "compose")
    .map(({ id }) => id).toSorted();
  const listeners = architecture.publishedListeners.map(({ service, published }) => ({ service, published }))
    .toSorted((left, right) => `${left.service}:${left.published}`.localeCompare(`${right.service}:${right.published}`));

  // when / then
  assert.deepEqual(services, composeServices());
  assert.deepEqual(listeners, publishedListeners());
  for (const listener of architecture.publishedListeners) {
    assert.equal(listener.exposure, listener.published.startsWith("127.0.0.1:") ? "loopback" : "public",
      `${listener.service}:${listener.published} has the wrong exposure`);
    for (const boundaryId of listener.boundaryIds) {
      const boundary = architecture.trustBoundaries.find(({ id }) => id === boundaryId);
      assert.ok(boundary, `${listener.service}:${listener.published} has unknown boundary ${boundaryId}`);
      assert.equal(boundary.to, listener.service,
        `${listener.service}:${listener.published} boundary ${boundaryId} does not enter the listener`);
      const expectedOrigin = listener.exposure === "loopback"
        ? ["operator"] : ["browser", "public-network", "acme-provider"];
      assert.ok(expectedOrigin.includes(boundary.from),
        `${listener.service}:${listener.published} uses ${boundaryId} from ${boundary.from}`);
    }
  }
  assert.notDeepEqual([...services, "unreviewed-service"].toSorted(), composeServices());
  assert.notDeepEqual([...listeners, { service: "proxy", published: "8443:8443" }], publishedListeners());
  const overlayApp = composeDocuments[1].document.services.app;
  overlayApp.ports = ["127.0.0.1:18080:8080"];
  try {
    assert.throws(() => publishedListeners(),
      /production overlays may not declare ports without a Compose-aware listener projection/);
  } finally {
    delete overlayApp.ports;
  }
});

test("given the reference mail configuration, when a listener changes, then every configured port needs a boundary", () => {
  // given
  const configured = architecture.sources.configuredListeners;
  const actual = configured.map(({ name, port }) => ({ name, port }));
  const boundaries = new Map(architecture.trustBoundaries.map((boundary) => [boundary.id, boundary]));

  // when / then
  assert.deepEqual(actual, configuredMailListeners());
  assert.deepEqual(configured.map(({ name, port, reachableSources }) => ({ name, port, reachableSources })),
    configuredMailListenerReachability(composeNetworkPosture()));
  for (const listener of configured) {
    assert.ok(listener.boundaryIds.length > 0, `${listener.name}:${listener.port} has no boundary`);
    for (const boundaryId of listener.boundaryIds) {
      assert.equal(boundaries.get(boundaryId)?.to, "mail", `${listener.name}:${listener.port} boundary misses mail`);
    }
    for (const source of listener.reachableSources) {
      assert.ok(listener.boundaryIds.some((id) => {
        const boundary = boundaries.get(id);
        return boundary?.from === source && boundary.to === "mail";
      }),
        `${listener.name}:${listener.port} is reachable from ${source} without a classified boundary`);
    }
    assert.ok(listener.accessControl.length > 0, `${listener.name}:${listener.port} hides its access control`);
    listener.evidence.forEach(assertTestAnchor);
  }
});

test("given the reference deployment networks, when reachability changes, then least-privilege isolation fails closed", () => {
  // given
  const posture = architecture.sources.networkPosture;
  const segments = architecture.sources.networkSegments;

  // when / then
  assert.deepEqual(posture, composeNetworkPosture());
  assert.deepEqual(segments.map(({ name, internal, members, egressGatewayFor }) =>
    ({ name, internal, members, egressGatewayFor })), composeNetworkSegments(posture));
  assert.equal(compose["x-courtside-compose-version"], ">=2.33.1");
  assert.match(deploymentDocumentation, /Compose 2\.33\.1 or newer/);
  for (const segment of segments) {
    assert.ok(segment.purpose.length > 0, `${segment.name} has no classified purpose`);
    assert.ok(segment.boundaryIds.length > 0, `${segment.name} has no trust boundary`);
    segment.boundaryIds.forEach((id) => assert.ok(
      architecture.trustBoundaries.some((boundary) => boundary.id === id), `${segment.name} has unknown ${id}`));
    for (const target of segment.protectedServices) {
      assert.ok(segment.members.includes(target), `${segment.name} protects absent service ${target}`);
      for (const source of segment.members.filter((member) => member !== target)) {
        assert.ok(segment.boundaryIds.some((id) => {
          const boundary = architecture.trustBoundaries.find((candidate) => candidate.id === id);
          return boundary?.from === source && boundary.to === target;
        }), `${segment.name} lets ${source} reach ${target} without a matching boundary`);
      }
    }
  }
  assert.deepEqual(sharedNetworks(posture, "app", "db"), ["database"]);
  assert.deepEqual(sharedNetworks(posture, "app", "proxy"), ["ingress"]);
  assert.deepEqual(sharedNetworks(posture, "app", "mail"), ["relay"]);
  assert.deepEqual(posture.find(({ service }) => service === "app").networks,
    ["app-egress", "database", "ingress", "relay"]);
  assert.deepEqual(posture.find(({ service }) => service === "proxy").networks,
    ["ingress", "proxy-egress"]);
  for (const helper of ["mail-bootstrap", "mail-configure", "mail-reload"]) {
    assert.deepEqual(sharedNetworks(posture, "mail", helper), ["mail-admin"]);
    assert.deepEqual(sharedNetworks(posture, "app", helper), []);
  }
  assert.deepEqual(sharedNetworks(posture, "mail", "mail-check"), ["mail-delivery"]);
  assert.equal(posture.find(({ service }) => service === "mail-certificate").mode, "none");
  assert.equal(posture.find(({ service }) => service === "mail-plan").mode, "none");
  const attachedServices = (network) => posture
    .filter(({ networks }) => networks.includes(network)).map(({ service }) => service).toSorted();
  assert.deepEqual(attachedServices("app-egress"), ["app"]);
  assert.deepEqual(attachedServices("proxy-egress"), ["proxy"]);
  assert.equal(compose.services.app.networks["app-egress"].gw_priority, 1);
  assert.equal(compose.services.mail.networks["mail-delivery"].gw_priority, 1);
  assert.equal(compose.services.proxy.networks["proxy-egress"].gw_priority, 1);
});

test("given reference mail delivery, when its MX route is mapped, then software bounds and external assumptions stay distinct", () => {
  // given
  const mxRoutes = mailPlan.filter(({ object }) => object === "MtaRoute")
    .flatMap(({ value }) => Object.values(value)).filter((route) => route["@type"] === "Mx");
  const outbound = mailPlan.find(({ object }) => object === "MtaOutboundStrategy");
  const deliveryFlows = architecture.trustBoundaries
    .filter(({ id }) => ["mail-dns", "mail-recipient-delivery"].includes(id));

  // when / then
  assert.equal(mxRoutes.length, 1);
  assert.deepEqual({ maxMxHosts: mxRoutes[0].maxMxHosts, maxMultihomed: mxRoutes[0].maxMultihomed },
    { maxMxHosts: 2, maxMultihomed: 2 });
  assert.equal(outbound.value.route.else, "'mx'");
  assert.equal(deliveryFlows.length, 2);
  for (const flow of deliveryFlows) {
    assert.ok(flow.productionPaths.includes("deploy/mail/base.ndjson"));
    assert.ok(flow.operationalAssumption, `${flow.id} hides externally owned behavior`);
  }
});

test("given optional telemetry export, when a collector stops responding, then every exporter has an explicit deadline", () => {
  // given
  const production = applicationConfigurations.find(({ name }) => name === "application.yaml").configuration;

  // when / then
  assert.deepEqual(production.management.opentelemetry.tracing.export.otlp, {
    endpoint: "${COURTSIDE_OTLP_TRACES_ENDPOINT:http://localhost:4318/v1/traces}",
    "connect-timeout": "2s",
    timeout: "10s"
  });
  assert.equal(production.management.otlp.metrics.export["connect-timeout"], "2s");
  assert.equal(production.management.otlp.metrics.export["read-timeout"], "10s");
});

test("given the local database TLS overlay, when production sources are closed, then its private material is bounded", () => {
  // given
  const localTls = composeDocuments.find(({ path }) => path === "deploy/compose.database-tls-local.yaml");
  const boundary = architecture.trustBoundaries
    .find(({ id }) => id === "operator-database-material");

  // when / then
  assert.ok(localTls, "the documented local database TLS overlay is outside the production manifest");
  assert.ok(localTls.document.services.db.volumes.every((mount) => mount.endsWith(":ro")));
  assert.match(localTls.document.services.db.command.join(" "), /install .* -m 0600 .*server\.key/);
  assert.deepEqual({ from: boundary?.from, to: boundary?.to }, { from: "operator", to: "db" });
  assert.ok(boundary.productionPaths.includes(localTls.path));
});

test("given the reference mail server, when its runtime WebUI dependency is reviewed, then the external ownership stays explicit", () => {
  // given
  const component = architecture.components.find(({ id }) => id === "stalwart-webadmin-release");
  const boundary = architecture.trustBoundaries.find(({ id }) => id === "mail-stalwart-webadmin-release");
  const image = reviewedImages().find(({ service }) =>
    service === boundary.reviewedImageService)?.image;
  const reviewed = `${boundary.reviewedImageRepository}:${boundary.reviewedImageTag}`
    + `@${boundary.reviewedImageDigest}`;

  // when / then
  assert.equal(component?.source, "external");
  assert.deepEqual({ from: boundary?.from, to: boundary?.to },
    { from: "mail", to: "stalwart-webadmin-release" });
  assert.equal(reviewed, image,
    "a mail image update needs a fresh review of its runtime WebUI dependency");
  const replaced = reviewedImages([...composeDocuments, { path: "deploy/compose.test.yaml", document: {
    services: { mail: { image: "stalwartlabs/stalwart:v-next@sha256:" + "a".repeat(64) } }
  } }]).find(({ service }) => service === "mail").image;
  assert.notEqual(reviewed, replaced,
    "an overlay image replacement must invalidate the reviewed WebUI dependency");
  assert.equal(boundary.allowedTarget,
    "Stalwart's built-in WebUI application release URL on github.com and objects.githubusercontent.com over HTTPS.");
  assert.match(boundary.dependencyFailureBehavior, /first download.*unavailable.*continue/i);
  assert.ok(boundary.operationalAssumption,
    "the pinned third-party server's unpinned runtime bundle must not look Courtside-controlled");
  assert.match(deploymentDocumentation, /web interface is not pinned/i);
});

test("given production outbound clients and browser destinations, when a new target appears, then it needs a classified boundary", () => {
  // given
  const clientSources = architecture.sources.outboundClientFiles.toSorted();
  const reviewedApiSources = architecture.sources.reviewedNetworkApiFiles.toSorted();
  const destinations = architecture.browserDestinations.flatMap(({ fields }) => fields).toSorted();
  const boundaries = new Map(architecture.trustBoundaries.map((boundary) => [boundary.id, boundary]));

  // when / then
  assert.deepEqual(clientSources, outboundClientFiles());
  assert.deepEqual(reviewedApiSources, reviewedNetworkApiFiles());
  assert.deepEqual(destinations, browserDestinations());
  assert.notDeepEqual([...clientSources, "src/main/java/org/courtside/UnreviewedClient.java"], outboundClientFiles());
  assert.notDeepEqual([...destinations, "ClubConfig.unreviewedUrl"], browserDestinations());
  for (const destination of architecture.browserDestinations) {
    const boundary = boundaries.get(destination.boundaryId);
    assert.equal(boundary?.from, "browser", `${destination.id} does not reference a browser boundary`);
  }
  for (const source of [
    "import java.net.http.HttpClient; class C { void call() { HttpClient.newHttpClient(); } }",
    "class C { void call() { java.net.http.HttpClient.newHttpClient(); } }",
    "import java.net.Socket; class C { void call() { new Socket(); } }",
    "import org.springframework.web.client.RestClient; class C {}",
    "import org.springframework.web.reactive.function.client.WebClient; class C {}",
    "import jakarta.mail.Transport; class C {}",
    "import software.amazon.awssdk.services.s3.S3Client; class C {}",
    "wget -q https://dependency.example/resource",
    "import { createConnection } from \"node:net\";"
  ]) assert.equal(isNetworkClientSource(source), true, source);
  for (const source of [
    "import java.net.InetAddress; class C {}",
    "class C { java.net.InetAddress address; }",
    "import javax.naming.directory.InitialDirContext; class C {}",
    "import io.grpc.ManagedChannel; class C {}",
    "import org.springframework.integration.ip.tcp.TcpInboundGateway; class C {}",
    "nslookup dependency.example"
  ]) assert.equal(networkApiPatterns.some((pattern) => pattern.test(source)), true, source);
});

test("given effective production network targets, when application or Compose configuration changes, then its boundary is classified", () => {
  // given
  const targets = architecture.sources.configuredTargets;
  const properties = targets.map(({ target }) => target).toSorted();
  const composeClassifications = [...properties.filter((target) => target.startsWith("compose:")),
    ...architecture.sources.nonTargetEnvironment].toSorted();

  // when / then
  for (const discovered of configuredNetworkTargets()) assert.ok(properties.includes(discovered),
    `${discovered} is not classified as a target`);
  assert.deepEqual(composeClassifications, composeEnvironmentNames());
  assert.equal(new Set(properties).size, properties.length, "a configured target is duplicated");
  for (const target of targets) {
    const requiredPath = target.target.startsWith("compose:")
      ? target.productionPath : architecture.sources.application;
    assert.ok(target.boundaryIds.length > 0, `${target.target} has no boundary`);
    for (const boundaryId of target.boundaryIds) {
      const boundary = architecture.trustBoundaries.find(({ id }) => id === boundaryId);
      assert.ok(boundary, `${target.target} has unknown boundary ${boundaryId}`);
      assert.ok(boundary.productionPaths.includes(requiredPath),
        `${target.target} boundary does not cite ${requiredPath}`);
    }
  }
  for (const serviceTarget of configuredComposeServiceTargets()) {
    const classification = targets.find(({ target }) => target === serviceTarget.configuredTarget);
    assert.ok(classification, `${serviceTarget.configuredTarget} has no target classification`);
    assert.ok(classification.boundaryIds.some((id) => {
      const boundary = architecture.trustBoundaries.find((candidate) => candidate.id === id);
      return boundary?.from === serviceTarget.source && boundary.to === serviceTarget.target;
    }), `${serviceTarget.configuredTarget} does not classify ${serviceTarget.source}->${serviceTarget.target}`);
  }
  assert.deepEqual(applicationNetworkTargets([{ name: "application-example.yaml", configuration: {
    management: { zipkin: { tracing: { endpoint: "https://collector.example" } } }
  } }]), ["application:application-example.yaml:management.zipkin.tracing.endpoint"]);
  assert.deepEqual(composeNetworkTargets({ ZIPKIN_ENDPOINT: "https://collector.example" }),
    ["compose:app:ZIPKIN_ENDPOINT"]);
});

test("given a trust boundary, when its endpoints and anchors are resolved, then it names real classified components and evidence", () => {
  // given
  const components = new Set(architecture.components.map(({ id }) => id));
  const participants = new Set(architecture.trustBoundaries.flatMap(({ from, to }) => [from, to]));

  // when / then
  assert.equal(components.size, architecture.components.length, "a component id is duplicated");
  assert.deepEqual([...participants].toSorted(), [...components].toSorted(),
    "a classified component participates in no documented boundary");
  for (const flow of architecture.trustBoundaries) {
    assert.ok(components.has(flow.from), `${flow.id} has unknown source ${flow.from}`);
    assert.ok(components.has(flow.to), `${flow.id} has unknown target ${flow.to}`);
    for (const path of flow.productionPaths) assert.equal(statSync(`${repository}/${path}`).isFile(), true, path);
    for (const anchor of flow.evidence) assertTestAnchor(anchor);
  }
  assert.equal(new Set(architecture.trustBoundaries.map(({ id }) => id)).size,
    architecture.trustBoundaries.length, "a trust boundary id is duplicated");
  for (const path of architecture.sources.outboundClientFiles) {
    assert.ok(architecture.trustBoundaries.some(({ productionPaths }) => productionPaths.includes(path)),
      `${path} has no outbound trust boundary`);
  }
  const derivedRelations = deploymentRelations();
  assert.deepEqual(architecture.sources.deploymentRelations.map(({ relation }) => relation).toSorted(),
    derivedRelations.map(({ id }) => id));
  for (const classified of architecture.sources.deploymentRelations) {
    const relation = derivedRelations.find(({ id }) => id === classified.relation);
    const boundary = architecture.trustBoundaries.find(({ id }) => id === classified.boundaryId);
    assert.ok(boundary, `${classified.relation} has unknown boundary ${classified.boundaryId}`);
    assert.equal(boundary.from, relation.from,
      `${classified.relation} source does not match ${classified.boundaryId}`);
    assert.equal(boundary.to, relation.to,
      `${classified.relation} does not match ${classified.boundaryId}`);
    if (relation.productionPath) {
      assert.ok(boundary.productionPaths.includes(relation.productionPath),
        `${classified.relation} omits its source ${relation.productionPath}`);
    }
  }
  assert.ok(derivedRelations.some(({ id }) =>
    id === "compose-bind:repository:operator:proxy:/etc/caddy/Caddyfile"),
  "repository-owned bind mounts need an explicit operator-to-service boundary");
});

test("given new Compose mounts, when deriving trust transitions, then no bind or shared writer stays implicit", () => {
  // given
  const shared = [{ path: "deploy/compose.test.yaml", document: {
    volumes: { shared: {} }, services: {
      first: { volumes: ["shared:/data"] },
      second: { volumes: ["shared:/data"] }
    }
  } }];
  const absolute = [{ path: "deploy/compose.test.yaml", document: { services: {
    first: { volumes: ["/srv/secret:/run/secret:ro"] }
  } } }];

  // when / then
  assert.deepEqual(composeMountRelations(shared).map(({ id }) => id), [
    "compose-volume:shared:first:second", "compose-volume:shared:second:first"
  ]);
  assert.equal(composeMountRelations(absolute)[0].id,
    "compose-bind:absolute:operator:first:/run/secret");
  assert.throws(() => composeMountRelations([{ path: "deploy/compose.test.yaml", document: {
    services: { first: { volumes: ["./certs/${CERT_FILE}:/cert:ro"] } }
  } }]), /unclassified bind source/);
  assert.throws(() => composeMountRelations([{ path: "deploy/compose.test.yaml", document: {
    services: { first: { volumes: ["${SECRET_FILE}:/run/secret"] } }
  } }]), /writable operator-controlled bind mount/);
  assert.throws(() => composeMountRelations([{ path: "deploy/compose.test.yaml", document: {
    volumes: { db: {} }, services: { first: { volumes: [
      { type: "bind", source: "db", target: "/run/material", read_only: true }
    ] } }
  } }]), /unclassified bind source db/);
});

test("given production entry points, when an operation or background task changes, then workflow coverage fails closed", () => {
  // given
  const classified = workflows.workflows.flatMap(({ operationIds }) => operationIds).toSorted();
  const expectedBackground = resourceDemand.classifications.flatMap(({ entryPoints }) => entryPoints)
    .filter((entryPoint) => entryPoint.includes("#")).toSorted();
  const classifiedBackground = workflows.workflows
    .flatMap(({ backgroundEntryPoints }) => backgroundEntryPoints).toSorted();

  // when / then
  assert.deepEqual(classified, operations());
  assert.equal(new Set(classified).size, classified.length, "an operation belongs to more than one workflow");
  assert.notDeepEqual([...classified, "unreviewedOperation"].toSorted(), operations());
  assert.notDeepEqual(classified.slice(1), operations());
  assert.deepEqual(classifiedBackground, expectedBackground);
  assert.equal(new Set(classifiedBackground).size, classifiedBackground.length,
    "a background entry point belongs to more than one workflow");
});

test("given workflow actors, when authorization changes, then the workflow inventory follows the operation contract", () => {
  // given
  const authorization = buildOperationAuthorizationMatrix(openapi);
  const knownActors = new Set(authorizationActors);

  // when / then
  for (const workflow of workflows.workflows) {
    const operationContracts = authorization
      .filter(({ operationId }) => workflow.operationIds.includes(operationId));
    assert.equal(operationContracts.length, workflow.operationIds.length,
      `${workflow.id} contains an operation without an authorization contract`);
    const expected = [...new Set(authorization
      .filter(({ operationId }) => workflow.operationIds.includes(operationId))
      .flatMap(({ expectations }) => Object.entries(expectations)
        .filter(([, outcome]) => outcome === "allow")
        .map(([actor]) => actor)))].toSorted();
    assert.deepEqual(workflow.actors.toSorted(), expected, `${workflow.id} actors contradict authorization`);
    assert.ok(workflow.actors.every((actor) => knownActors.has(actor)), `${workflow.id} has an unknown actor`);
  }
});

test("given a principal workflow, when its paths are followed, then its production and failure evidence exists", () => {
  // when / then
  for (const workflow of workflows.workflows) {
    for (const path of workflow.productionPaths) assert.equal(statSync(`${repository}/${path}`).isFile(), true, path);
    for (const anchor of workflow.evidence) assertTestAnchor(anchor);
  }
  assert.equal(new Set(workflows.workflows.map(({ id }) => id)).size, workflows.workflows.length,
    "a workflow id is duplicated");
});

function assertTestAnchor(anchor) {
  const separator = anchor.indexOf("#");
  const path = anchor.slice(0, separator);
  const name = anchor.slice(separator + 1);
  const source = readFileSync(`${repository}/${path}`, "utf8");
  if (name === "main") {
    assert.match(source, /\b(?:async\s+)?function\s+main\s*\(/, anchor);
    assert.match(source, /\bawait\s+main\s*\(\s*\)/, anchor);
    return;
  }
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  assert.match(source, new RegExp(String.raw`(?:\bvoid\s+${escaped}\s*\(|\b(?:test|it)\(\s*"${escaped}")`), anchor);
}
