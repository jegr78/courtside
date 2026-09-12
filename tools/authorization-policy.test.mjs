import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  authorizationFieldFingerprints,
  discoverAuthorizationMethods,
  ordinaryAuthorizationFields,
  productionAuthorizationFingerprint,
  renderAuthorizationPolicy,
  validateAuthorizationPolicy
} from "./authorization-policy.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const YAML = require("yaml");
const policy = JSON.parse(readFileSync(new URL(
  "../security/authorization-policy.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL(
  "../security/authorization-policy.schema.json", import.meta.url), "utf8"));
const api = YAML.parse(readFileSync(new URL(
  "../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
const workflows = JSON.parse(readFileSync(new URL(
  "../security/production-workflows.json", import.meta.url), "utf8"));
const documentation = readFileSync(new URL(
  "../docs/authorization-policy.md", import.meta.url), "utf8");
const productionSources = javaSources(new URL("../src/main/java/", import.meta.url));

function javaSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const location = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return javaSources(location);
    if (!entry.name.endsWith(".java")) return [];
    return [{
      path: location.pathname.slice(new URL("../", import.meta.url).pathname.length),
      source: readFileSync(location, "utf8")
    }];
  });
}

const validate = (candidate) => validateAuthorizationPolicy(candidate, {
  schema,
  api,
  workflows,
  productionSources,
  readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
});
const copy = () => structuredClone(policy);

test("given the shipped API and production authorization paths, when reading the policy, then every rule is complete and falsifiable", () => {
  // when
  const result = validate(policy);

  // then
  assert.equal(result.operationCount, 108);
  assert.equal(result.protectedFieldCount > 0, true);
  assert.equal(result.decisionCount > 0, true);
});

test("given an OpenAPI operation without a maintained rule, when validating the policy, then validation fails closed", () => {
  // given
  const candidate = copy();
  candidate.operationRules[0].operationIds.shift();

  // when / then
  assert.throws(() => validate(candidate), /operation .* has no authorization rule/);
});

test("given an operation named by two rules, when validating the policy, then validation fails closed", () => {
  // given
  const candidate = copy();
  candidate.operationRules[1].operationIds.push(candidate.operationRules[0].operationIds[0]);

  // when / then
  assert.throws(() => validate(candidate), /operation .* has 2 authorization rules/);
});

test("given an undocumented actor or authorization decision, when validating the policy, then validation fails closed", () => {
  // given
  const unknownActor = copy();
  unknownActor.operationRules[0].actors.push("SUPERUSER");
  const unknownDecision = copy();
  unknownDecision.operationRules[0].decisions.push("missing-decision");
  const unknownAttribute = copy();
  unknownAttribute.decisions[0].attributes.push("undocumented-state");

  // when / then
  assert.throws(() => validate(unknownActor), /unknown actor SUPERUSER/);
  assert.throws(() => validate(unknownDecision), /unknown decision missing-decision/);
  assert.throws(() => validate(unknownAttribute), /unknown attribute undocumented-state/);
});

test("given a protected field with an unknown schema location or uncovered operation, when validating the policy, then validation fails closed", () => {
  // given
  const unknownField = copy();
  unknownField.fieldRules[0].fields.push("SessionStatus.notAField");
  const uncoveredOperation = copy();
  uncoveredOperation.fieldRules[0].operationIds = [];
  const unrelatedField = copy();
  const sessionRule = unrelatedField.fieldRules.find(({ id }) => id === "session-identity-read");
  sessionRule.fields = ["PersonRequest.firstName"];

  // when / then
  assert.throws(() => validate(unknownField), /unknown protected field/);
  assert.throws(() => validate(uncoveredOperation), /fewer than 1|must cover at least one operation/);
  assert.throws(() => validate(unrelatedField), /is not in the response of getSessionStatus/);
});

test("given a protected field rule is removed, when validating the policy, then the reviewed inventory fails closed", () => {
  // given
  const candidate = copy();
  candidate.fieldRules.shift();

  // when / then
  assert.throws(() => validate(candidate), /protected field inventory changed/);
});

test("given a new inline request field, when validating the policy, then the reviewed OpenAPI field inventory fails closed", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.paths["/api/session"].post.requestBody.content[
    "application/x-www-form-urlencoded"
  ].schema.properties.oneTimeCode = { type: "string" };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api: changedApi,
    workflows,
    productionSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }), /OpenAPI field inventory changed/);
});

test("given a referenced request body or structured parameter gains a field, when inventorying the API, then the field cannot escape review", () => {
  // given
  const requestBodyApi = structuredClone(api);
  requestBodyApi.components.requestBodies = {
    SecretBody: {
      content: { "application/json": { schema: {
        type: "object", properties: { secretNew: { type: "string" } }
      } } }
    }
  };
  requestBodyApi.paths["/api/session/logout"].post.requestBody = {
    $ref: "#/components/requestBodies/SecretBody"
  };
  const parameterApi = structuredClone(api);
  parameterApi.paths["/api/bookings"].get.parameters[0].schema = {
    type: "object", properties: { secretNested: { type: "string" } }
  };

  // when / then
  for (const changedApi of [requestBodyApi, parameterApi]) {
    assert.notEqual(
      authorizationFieldFingerprints(changedApi, policy).openApiFieldInventorySha256,
      policy.openApiFieldInventorySha256
    );
  }
});

test("given protected request fields arrive through a local request-body reference, when validating the policy, then the fields remain addressable", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.components.requestBodies = {
    LoginBody: changedApi.paths["/api/session"].post.requestBody
  };
  changedApi.paths["/api/session"].post.requestBody = {
    $ref: "#/components/requestBodies/LoginBody"
  };

  // when / then
  assert.doesNotThrow(() => validateAuthorizationPolicy(policy, {
    schema,
    api: changedApi,
    workflows,
    productionSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }));
});

test("given an external OpenAPI reference appears at a transport boundary, when inventorying the API, then review fails closed", () => {
  // given
  const variants = [
    (candidate) => { candidate.paths["/api/session/logout"].post.requestBody = { $ref: "./body.yaml" }; },
    (candidate) => { candidate.paths["/api/bookings"].get.parameters[0] = { $ref: "./parameter.yaml" }; },
    (candidate) => { candidate.paths["/api/source"].get.responses["200"] = { $ref: "./response.yaml" }; },
    (candidate) => {
      candidate.paths["/api/source"].get.responses["200"].headers = {
        Secret: { $ref: "./header.yaml" }
      };
    }
  ];

  // when / then
  for (const mutate of variants) {
    const changedApi = structuredClone(api);
    mutate(changedApi);
    assert.throws(() => authorizationFieldFingerprints(changedApi, policy),
      /external OpenAPI reference/);
  }
});

test("given transport references are chained through local components, when inventorying the API, then their fields remain visible", () => {
  // given
  const variants = [
    (candidate) => {
      candidate.components.requestBodies = {
        ...candidate.components.requestBodies,
        A: { $ref: "#/components/requestBodies/B" },
        B: { content: { "application/json": { schema: {
          type: "object", properties: { chainedRequest: { type: "string" } }
        } } } }
      };
      candidate.paths["/api/session/logout"].post.requestBody = {
        $ref: "#/components/requestBodies/A"
      };
    },
    (candidate) => {
      candidate.components.parameters = {
        ...candidate.components.parameters,
        A: { $ref: "#/components/parameters/B" },
        B: { name: "filter", in: "query", schema: {
          type: "object", properties: { chainedParameter: { type: "string" } }
        } }
      };
      candidate.paths["/api/bookings"].get.parameters[0] = {
        $ref: "#/components/parameters/A"
      };
    },
    (candidate) => {
      candidate.components.responses = {
        ...candidate.components.responses,
        A: { $ref: "#/components/responses/B" },
        B: { description: "ok", content: { "application/json": { schema: {
          type: "object", properties: { chainedResponse: { type: "string" } }
        } } } }
      };
      candidate.paths["/api/source"].get.responses["200"] = {
        $ref: "#/components/responses/A"
      };
    },
    (candidate) => {
      candidate.components.headers = {
        ...candidate.components.headers,
        A: { $ref: "#/components/headers/B" },
        B: { schema: {
          type: "object", properties: { chainedHeader: { type: "string" } }
        } }
      };
      candidate.paths["/api/source"].get.responses["200"].headers = {
        Chained: { $ref: "#/components/headers/A" }
      };
    }
  ];

  // when / then
  for (const mutate of variants) {
    const changedApi = structuredClone(api);
    mutate(changedApi);
    assert.notEqual(
      authorizationFieldFingerprints(changedApi, policy).openApiFieldInventorySha256,
      policy.openApiFieldInventorySha256
    );
  }
});

test("given transport references form a local cycle, when inventorying the API, then review fails closed", () => {
  // given
  const variants = [
    ["requestBodies", (candidate, reference) => {
      candidate.paths["/api/session/logout"].post.requestBody = reference;
    }],
    ["parameters", (candidate, reference) => {
      candidate.paths["/api/bookings"].get.parameters[0] = reference;
    }],
    ["responses", (candidate, reference) => {
      candidate.paths["/api/source"].get.responses["200"] = reference;
    }],
    ["headers", (candidate, reference) => {
      candidate.paths["/api/source"].get.responses["200"].headers = { Cyclic: reference };
    }]
  ];

  // when / then
  for (const [component, attach] of variants) {
    const changedApi = structuredClone(api);
    changedApi.components[component] = {
      ...changedApi.components[component],
      A: { $ref: `#/components/${component}/B` },
      B: { $ref: `#/components/${component}/A` }
    };
    attach(changedApi, { $ref: `#/components/${component}/A` });
    assert.throws(() => authorizationFieldFingerprints(changedApi, policy),
      /cyclic OpenAPI reference/);
  }
});

test("given a protected container gains a child field, when classifying fields, then the child inherits the container restriction", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.components.schemas.SubjectAccessAccount.properties.newSecret = { type: "string" };

  // when
  const ordinary = ordinaryAuthorizationFields(changedApi, policy);

  // then
  assert.equal(ordinary.includes("exportPersonData:response:SubjectAccessAccount.newSecret"), false);
});

test("given inherited and explicit rules protect the same concrete field, when validating the policy, then the conflicting decisions fail closed", () => {
  // given
  const candidate = copy();
  const parentRule = candidate.fieldRules.find(({ id }) => id === "subject-access-read");
  candidate.fieldRules.push({
    ...structuredClone(parentRule),
    id: "overlapping-subject-account-rule",
    fields: ["SubjectAccessAccount.username"]
  });

  // when / then
  assert.throws(() => validate(candidate), /resolves to multiple rules/);
});

test("given a response schema references a missing local component, when inventorying the API, then review fails closed", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.paths["/api/source"].get.responses["200"].content[
    "application/json"
  ].schema = { $ref: "#/components/schemas/Missing" };

  // when / then
  assert.throws(() => authorizationFieldFingerprints(changedApi, policy),
    /OpenAPI schema reference .* does not resolve/);
});

test("given fields arrive through schema alternatives or map values, when validating the policy, then neither shape escapes the reviewed inventory", () => {
  // given
  const alternativeApi = structuredClone(api);
  alternativeApi.paths["/api/session"].post.requestBody.content[
    "application/x-www-form-urlencoded"
  ].schema.oneOf = [{ type: "object", properties: { secretBranch: { type: "string" } } }];
  const mapApi = structuredClone(api);
  mapApi.paths["/api/session"].post.requestBody.content[
    "application/x-www-form-urlencoded"
  ].schema.additionalProperties = {
    type: "object", properties: { secretMapValue: { type: "string" } }
  };
  const referenceSiblingApi = structuredClone(api);
  referenceSiblingApi.paths["/api/source"].get.responses["200"].content[
    "application/json"
  ].schema.properties = { secretSibling: { type: "string" } };
  const recursiveSiblingApi = structuredClone(api);
  recursiveSiblingApi.components.schemas.RecursiveNode = {
    type: "object",
    properties: {
      child: {
        $ref: "#/components/schemas/RecursiveNode",
        properties: { secretRecursiveSibling: { type: "string" } }
      }
    }
  };
  recursiveSiblingApi.paths["/api/source"].get.responses["200"].content[
    "application/json"
  ].schema = { $ref: "#/components/schemas/RecursiveNode" };

  // when / then
  for (const changedApi of [alternativeApi, mapApi, referenceSiblingApi, recursiveSiblingApi]) {
    assert.throws(() => validateAuthorizationPolicy(policy, {
      schema,
      api: changedApi,
      workflows,
      productionSources,
      readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    }), /OpenAPI field inventory changed/);
  }
});

test("given an unsupported field-bearing schema applicator appears, when inventorying the API, then review fails closed", () => {
  // given
  const variants = [
    { patternProperties: { "^secret": { type: "string" } } },
    { if: { properties: { mode: { const: "secret" } } }, then: { properties: { secret: { type: "string" } } } },
    { $defs: { Secret: { type: "object", properties: { value: { type: "string" } } } } }
  ];

  // when / then
  for (const variant of variants) {
    const changedApi = structuredClone(api);
    Object.assign(changedApi.paths["/api/session"].post.requestBody.content[
      "application/x-www-form-urlencoded"
    ].schema, variant);
    assert.throws(() => authorizationFieldFingerprints(changedApi, policy),
      /unsupported OpenAPI schema keyword/);
  }
});

test("given a new field and an updated API fingerprint but no classification, when validating the policy, then the classification inventory fails closed", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.paths["/api/session"].post.requestBody.content[
    "application/x-www-form-urlencoded"
  ].schema.properties.oneTimeCode = { type: "string" };
  const candidate = copy();
  candidate.openApiFieldInventorySha256 = authorizationFieldFingerprints(changedApi, candidate)
    .openApiFieldInventorySha256;

  // when / then
  assert.throws(() => validateAuthorizationPolicy(candidate, {
    schema,
    api: changedApi,
    workflows,
    productionSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }), /API fields and maintained field classifications differ/);
});

test("given a schema is reused by another operation and the API fingerprint is updated, when validating the policy, then that operation needs its own field classification", () => {
  // given
  const changedApi = structuredClone(api);
  changedApi.paths["/api/session"].get.responses["299"] = {
    description: "A deliberately misplaced role projection.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/RolesRequest" } }
    }
  };
  const candidate = copy();
  candidate.openApiFieldInventorySha256 = authorizationFieldFingerprints(changedApi, candidate)
    .openApiFieldInventorySha256;

  // when / then
  assert.throws(() => validateAuthorizationPolicy(candidate, {
    schema,
    api: changedApi,
    workflows,
    productionSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }), /API fields and maintained field classifications differ/);
});

test("given the maintained field classifications, when fingerprinting them, then both reviewed inventories match", () => {
  // when
  const fingerprints = authorizationFieldFingerprints(api, policy);

  // then
  assert.deepEqual(fingerprints, {
    openApiFieldInventorySha256: policy.openApiFieldInventorySha256,
    protectedFieldInventorySha256: policy.protectedFieldInventorySha256
  });
});

test("given a decision without a real enforcement path or falsifying test, when validating the policy, then validation fails closed", () => {
  // given
  const missingPath = copy();
  missingPath.decisions[0].productionPaths = ["src/main/java/missing.java#missing"];
  const missingTest = copy();
  missingTest.decisions[0].negativeTests = ["src/test/java/missing.java#notATest"];

  // when / then
  assert.throws(() => validate(missingPath), /cannot read production path/);
  assert.throws(() => validate(missingTest), /cannot read test path/);
});

test("given a reviewed authorization method changes, when validating the policy, then the production inventory fails closed", () => {
  // given
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path.endsWith("SecurityConfiguration.java")
      ? source.replaceAll("PASSWORD_CHANGE_REQUIRED", "PASSWORD_CHANGE_BYPASSED")
      : source;
  };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources,
    readSource: changed
  }), /production authorization paths changed/);
});

test("given a new production authorization method in a known security file, when the source is reviewed, then it still needs an exact documented decision", () => {
  // given
  const securityPath = "src/main/java/org/courtside/identity/internal/SecurityConfiguration.java";
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path === securityPath
      ? source.replace(/\n}\s*$/, `

    boolean permitsTrainer(Set<Role> roles) {
        return roles.contains(Role.TRAINER);
    }
}
`)
      : source;
  };
  const changedSources = productionSources.map(({ path, source }) => ({
    path,
    source: path === securityPath ? changed(path) : source
  }));
  const candidate = copy();
  candidate.productionAuthorizationSha256 = productionAuthorizationFingerprint(candidate, changed);

  // when / then
  assert.throws(() => validateAuthorizationPolicy(candidate, {
    schema,
    api,
    workflows,
    productionSources: changedSources,
    readSource: changed
  }), /SecurityConfiguration\.java#permitsTrainer has no documented decision/);
});

test("given a Spring authorization annotation appears in a new production file, when validating the policy, then the operation needs a documented decision", () => {
  // given
  const changedSources = [...productionSources, {
    path: "src/main/java/org/courtside/example/AnnotatedGuard.java",
    source: `package org.courtside.example;
class AnnotatedGuard {
    @PreAuthorize("hasRole('ADMIN')")
    boolean readsProtectedState() {
        return true;
    }
}`
  }];

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources: changedSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }), /AnnotatedGuard\.java#readsProtectedState has no documented decision/);
});

test("given authorization annotations are multiline or type-scoped, when discovering decisions, then every affected method remains visible", () => {
  // given
  const sources = [{
    path: "src/main/java/org/courtside/example/MultilineGuard.java",
    source: `@PreAuthorize(
        "hasRole('ADMIN')"
    )
interface MultilineGuard {
    boolean first();
    boolean second();
}`
  }];

  // when / then
  assert.deepEqual(discoverAuthorizationMethods(sources), [
    "src/main/java/org/courtside/example/MultilineGuard.java#first",
    "src/main/java/org/courtside/example/MultilineGuard.java#second"
  ]);
});

test("given an unknown security annotation appears, when discovering production decisions, then review fails closed", () => {
  // given
  const sources = [{
    path: "src/main/java/org/courtside/example/UnknownGuard.java",
    source: "class UnknownGuard { @CustomAuthorization boolean permits() { return true; } }"
  }];

  // when / then
  assert.throws(() => discoverAuthorizationMethods(sources), /unsupported security annotation/);
});

test("given a Spring security meta-annotation is declared with any legal nesting modifier, when discovering production decisions, then review fails closed until composition is modeled", () => {
  // given
  const modifiers = ["", "public ", "protected ", "private ", "static ", "private static "];

  // when / then
  for (const modifier of modifiers) {
    const sources = [{
      path: "src/main/java/org/courtside/example/AdminOnly.java",
      source: `@PreAuthorize("hasRole('ADMIN')")
${modifier}@interface AdminOnly {}`
    }];
    assert.throws(() => discoverAuthorizationMethods(sources), /security meta-annotation/);
  }
});

test("given a role guard is added below the shared production package, when validating the policy, then it needs a documented decision", () => {
  // given
  const changedSources = [...productionSources, {
    path: "src/main/java/org/courtside/shared/SharedGuard.java",
    source: `class SharedGuard {
    boolean permits(Set<Role> roles) { return roles.contains(Role.ADMIN); }
}`
  }];

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources: changedSources,
    readSource: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  }), /SharedGuard\.java#permits has no documented decision/);
});

test("given the production authorization idioms, when discovering decisions, then identity, ownership, role and delegated guards remain visible", () => {
  // when
  const discovered = new Set(discoverAuthorizationMethods(productionSources));

  // then
  assert.deepEqual([
    "src/main/java/org/courtside/booking/ParticipationService.java#withdraw",
    "src/main/java/org/courtside/booking/internal/BookingAccessControl.java#requireRoleManagementAccess",
    "src/main/java/org/courtside/booking/web/BookingController.java#createBooking",
    "src/main/java/org/courtside/dataexchange/ExecutionService.java#requireSameActor",
    "src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#accountId"
  ].filter((anchor) => !discovered.has(anchor)), []);
});

test("given a projection method is called before its declaration, when that declaration changes, then the actual method remains fingerprinted", () => {
  // given
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path.endsWith("ImportPreviewAdminController.java")
      ? source.replace("summary.rowCount()", "summary.rowCount() + 1")
      : source;
  };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources,
    readSource: changed
  }), /production authorization paths changed/);
});

test("given an anchored method delegates account selection, when that helper changes, then the containing authorization file remains fingerprinted", () => {
  // given
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path.endsWith("OwnMessageChoices.java")
      ? source.replace("return currentUser.requireAccount().getId();", "return UUID.randomUUID();")
      : source;
  };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources,
    readSource: changed
  }), /production authorization paths changed/);
});

test("given allocation visibility is widened, when validating the reviewed projection, then the production inventory fails closed", () => {
  // given
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path.endsWith("AllocationVisibilityService.java")
      ? source.replace(".map(account -> account.getId().equals(booking.getBookedBy()))", ".map(account -> true)")
      : source;
  };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources,
    readSource: changed
  }), /production authorization paths changed/);
});

test("given the managed-list role query is widened, when validating the reviewed scope, then the production inventory fails closed", () => {
  // given
  const changed = (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    return path.endsWith("BookingRepository.java")
      ? source.replace("WHERE (:administrator = true OR EXISTS (", "WHERE (:administrator = true OR true OR EXISTS (")
      : source;
  };

  // when / then
  assert.throws(() => validateAuthorizationPolicy(policy, {
    schema,
    api,
    workflows,
    productionSources,
    readSource: changed
  }), /production authorization paths changed/);
});

test("given the maintained authorization methods, when fingerprinting them, then the reviewed production inventory matches", () => {
  // when
  const fingerprint = productionAuthorizationFingerprint(
    policy,
    (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
  );

  // then
  assert.equal(fingerprint, policy.productionAuthorizationSha256);
});

test("given the maintained policy, when rendering its human-readable form, then the committed documentation is current", () => {
  // when
  const rendered = renderAuthorizationPolicy(policy);

  // then
  assert.equal(documentation, rendered);
});
