import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { authorizationActors, buildOperationAuthorizationMatrix } from "./security-authorization.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020");

export function validateAuthorizationPolicy(policy, {
  schema, api, workflows, readSource, productionSources
}) {
  const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validateSchema(policy)) {
    throw new Error(`Authorization policy schema validation failed: ${JSON.stringify(validateSchema.errors)}`);
  }

  const matrix = buildOperationAuthorizationMatrix(api);
  const operations = new Map(matrix.map((operation) => [operation.operationId, operation]));
  const workflowOperations = workflows.workflows.flatMap(({ operationIds }) => operationIds).toSorted();
  assertSameMembers(workflowOperations, [...operations.keys()].toSorted(),
    "production workflow and OpenAPI operation inventories differ");

  const principalIds = new Set(policy.principals.map(({ id }) => id));
  assertUniqueIds(policy.principals, "principal");
  assertSameMembers([...principalIds].toSorted(), authorizationActors.toSorted(),
    "policy principals and runtime assessment actors differ");
  const productRoles = api.components?.schemas?.Role?.enum ?? [];
  const documentedRoles = [...principalIds]
    .filter((actor) => !["ANONYMOUS", "INITIAL_PASSWORD"].includes(actor)).toSorted();
  assertSameMembers(documentedRoles, productRoles.toSorted(),
    "policy principals and OpenAPI product roles differ");
  assertUniqueIds(policy.operationRules, "operation rule");
  assertUniqueIds(policy.decisions, "authorization decision");
  assertUniqueIds(policy.fieldRules, "field rule");
  assertUniqueIds(policy.attributes, "authorization attribute");
  const attributes = new Set(policy.attributes.map(({ id }) => id));
  const usedAttributes = new Set();
  const decisions = new Map(policy.decisions.map((decision) => [decision.id, decision]));
  const coverage = new Map([...operations.keys()].map((operationId) => [operationId, []]));
  const usedDecisions = new Set();
  const productionAnchors = new Set();

  for (const rule of policy.operationRules) {
    for (const actor of rule.actors) {
      if (!principalIds.has(actor)) throw new Error(`${rule.id} names unknown actor ${actor}`);
    }
    for (const decisionId of rule.decisions) {
      if (!decisions.has(decisionId)) throw new Error(`${rule.id} names unknown decision ${decisionId}`);
      usedDecisions.add(decisionId);
    }
    for (const operationId of rule.operationIds) {
      if (!operations.has(operationId)) throw new Error(`${rule.id} names unknown operation ${operationId}`);
      coverage.get(operationId).push(rule.id);
    }
  }
  for (const [operationId, rules] of coverage) {
    if (rules.length === 0) throw new Error(`operation ${operationId} has no authorization rule`);
    if (rules.length !== 1) throw new Error(`operation ${operationId} has ${rules.length} authorization rules`);
    const rule = policy.operationRules.find(({ id }) => id === rules[0]);
    const assessedActors = Object.entries(operations.get(operationId).expectations)
      .filter(([, expected]) => expected === "allow").map(([actor]) => actor).toSorted();
    assertSameMembers(rule.actors.toSorted(), assessedActors,
      `${operationId} policy actors differ from the runtime authorization matrix`);
  }

  for (const decision of policy.decisions) {
    for (const attribute of decision.attributes) {
      if (!attributes.has(attribute)) throw new Error(`${decision.id} names unknown attribute ${attribute}`);
      usedAttributes.add(attribute);
    }
    verifyAnchors(decision.productionPaths, "production path", readSource, false, productionAnchors);
    verifyAnchors([...decision.positiveTests, ...decision.negativeTests], "test path", readSource, true);
  }

  const protectedFields = new Set();
  const protectedClassifications = new Set();
  const classificationRules = new Map();
  const fieldUses = operationFieldUses(api);
  for (const fieldRule of policy.fieldRules) {
    if (fieldRule.operationIds.length === 0) throw new Error(`${fieldRule.id} must cover at least one operation`);
    for (const operationId of fieldRule.operationIds) {
      if (!operations.has(operationId)) throw new Error(`${fieldRule.id} names unknown operation ${operationId}`);
      const operationRule = policy.operationRules.find((rule) => rule.operationIds.includes(operationId));
      assertSameMembers(fieldRule.actors.toSorted(), operationRule.actors.toSorted(),
        `${fieldRule.id} actors differ from ${operationId}`);
    }
    for (const actor of fieldRule.actors) {
      if (!principalIds.has(actor)) throw new Error(`${fieldRule.id} names unknown actor ${actor}`);
    }
    for (const attribute of fieldRule.attributes) {
      if (!attributes.has(attribute)) throw new Error(`${fieldRule.id} names unknown attribute ${attribute}`);
      usedAttributes.add(attribute);
    }
    for (const decisionId of fieldRule.decisions) {
      if (!decisions.has(decisionId)) throw new Error(`${fieldRule.id} names unknown decision ${decisionId}`);
      usedDecisions.add(decisionId);
    }
    for (const field of fieldRule.fields) {
      for (const operationId of fieldRule.operationIds) {
        if (!operationFieldExists(api, operationId, fieldRule.access, field)) {
          throw new Error(`${fieldRule.id} names unknown protected field ${field}`);
        }
        const [schemaName] = field.split(".");
        const surfaces = operationSchemaNames(api, operationId);
        const expectedSurface = fieldRule.access === "read" ? surfaces.responses : surfaces.requests;
        if (!field.startsWith("$request.") && !expectedSurface.has(schemaName)) {
          throw new Error(`${fieldRule.id} names ${field}, which is not in the ${fieldRule.access === "read" ? "response" : "request"} of ${operationId}`);
        }
        if (fieldRule.access === "never-read" && surfaces.responses.has(schemaName)) {
          throw new Error(`${fieldRule.id} exposes write-only schema ${schemaName} from ${operationId}`);
        }
        const key = `${operationId}:${field}:${fieldRule.access}`;
        if (protectedFields.has(key)) throw new Error(`protected field rule ${key} is duplicated`);
        protectedFields.add(key);
        const direction = fieldRule.access === "read" ? "response" : "request";
        const matches = fieldUses.filter((use) => use.operationId === operationId
          && use.direction === direction && use.reference === field);
        if (matches.length === 0) {
          throw new Error(`${fieldRule.id} does not resolve ${field} to a concrete ${operationId} field use`);
        }
        for (const use of matches.flatMap((match) => fieldUseAndDescendants(fieldUses, match))) {
          const classification = fieldClassificationKey(use);
          protectedClassifications.add(classification);
          const rules = classificationRules.get(classification) ?? new Set();
          rules.add(fieldRule.id);
          classificationRules.set(classification, rules);
          if (rules.size > 1) {
            throw new Error(`protected field ${classification} resolves to multiple rules: ${[...rules].join(", ")}`);
          }
        }
      }
    }
  }
  for (const attribute of attributes) {
    if (!usedAttributes.has(attribute)) throw new Error(`authorization attribute ${attribute} is unreferenced`);
  }
  for (const decision of policy.decisions) {
    if (!usedDecisions.has(decision.id)) throw new Error(`authorization decision ${decision.id} is unreferenced`);
  }

  const openApiFieldInventorySha256 = fingerprint(operationFieldInventory(api));
  if (policy.openApiFieldInventorySha256 !== openApiFieldInventorySha256) {
    throw new Error("OpenAPI field inventory changed without authorization review");
  }
  const protectedFieldInventorySha256 = fingerprint([...protectedFields].toSorted());
  if (policy.protectedFieldInventorySha256 !== protectedFieldInventorySha256) {
    throw new Error("protected field inventory changed without authorization review");
  }
  const ordinaryFields = new Set(policy.ordinaryFields);
  if (ordinaryFields.size !== policy.ordinaryFields.length) {
    throw new Error("ordinary field classification is duplicated");
  }
  for (const field of protectedClassifications) {
    if (ordinaryFields.has(field)) throw new Error(`protected field ${field} is also classified as ordinary`);
  }
  assertSameMembers(
    [...ordinaryFields, ...protectedClassifications].toSorted(),
    [...new Set(fieldUses.map(fieldClassificationKey))].toSorted(),
    "API fields and maintained field classifications differ"
  );
  const productionFiles = new Set([...productionAnchors].map((anchor) => anchor.split("#")[0]));
  const productionAuthorizationSha256 = fingerprint([...productionFiles].toSorted()
    .map((path) => `${path}\n${readSource(path)}`));
  if (policy.productionAuthorizationSha256 !== productionAuthorizationSha256) {
    throw new Error("production authorization paths changed without authorization review");
  }
  const discoveredAuthorizationMethods = discoverAuthorizationMethods(productionSources);
  for (const anchor of discoveredAuthorizationMethods) {
    if (!productionAnchors.has(anchor)) {
      throw new Error(`production authorization method ${anchor} has no documented decision`);
    }
  }

  return {
    operationCount: operations.size,
    decisionCount: decisions.size,
    protectedFieldCount: protectedFields.size
  };
}

function verifyAnchors(anchors, kind, readSource, testAnchor = false, resolved = new Set()) {
  for (const anchor of anchors) {
    const [path, name, extra] = anchor.split("#");
    if (extra !== undefined || !name) throw new Error(`${kind} ${anchor} is malformed`);
    let source;
    try {
      source = readSource(path);
    } catch {
      throw new Error(`cannot read ${kind} ${path}`);
    }
    if (testAnchor) {
      const literal = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const declaration = new RegExp(String.raw`\bvoid\s+${literal}\s*\(`);
      if (!declaration.test(source)) throw new Error(`${kind} ${anchor} does not resolve`);
    } else {
      javaMethod(source, name);
      resolved.add(anchor);
    }
  }
}

function javaMethod(source, name) {
  const [symbol, arityText, extra] = name.split("/");
  if (extra !== undefined || (arityText !== undefined && !/^\d+$/.test(arityText))) {
    throw new Error(`production symbol ${name} is malformed`);
  }
  let matches = javaMethodMatches(source, symbol);
  if (arityText !== undefined) {
    const arity = Number(arityText);
    matches = matches.filter((match) => javaMethodArity(source, match) === arity);
  }
  if (matches.length !== 1) {
    throw new Error(`production symbol ${name} resolves to ${matches.length} method declarations`);
  }
  try {
    return javaMethodAt(source, matches[0], symbol);
  } catch (error) {
    if (/has no body/.test(error.message)) return symbol;
    throw error;
  }
}

function javaMethodMatches(source, name) {
  const literal = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const declaration = new RegExp(
    String.raw`^[ \t]*(?!return\b|throw\b|new\b)(?:(?:public|protected|private|static|final|synchronized|abstract|native|default)[ \t]+|@[\w.]+(?:\([^\n)]*\))?[ \t]+)*(?:<[^\n>]+>[ \t]+)?[A-Za-z_$][\w$.\[\]]*(?:[ \t]*<[^\n;=(){}]+>)?[ \t]+(${literal})[ \t]*\(`,
    "gm"
  );
  return [...source.matchAll(declaration)].map((match) => ({
    index: match.index + match[0].lastIndexOf(match[1])
  }));
}

function javaMethodAt(source, match, name) {
  const start = source.lastIndexOf("\n", match.index) + 1;
  let parameterDepth = 0;
  let closingParenthesis = -1;
  for (let index = source.indexOf("(", match.index); index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      closingParenthesis = index;
      break;
    }
  }
  const openingBrace = source.indexOf("{", closingParenthesis);
  const semicolon = source.indexOf(";", closingParenthesis);
  if (semicolon >= 0 && (openingBrace < 0 || semicolon < openingBrace)) {
    throw new Error(`production symbol ${name} has no body`);
  }
  if (openingBrace < 0) throw new Error(`production symbol ${name} has no body`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1).trim();
  }
  throw new Error(`production symbol ${name} has an unterminated body`);
}

function javaMethodArity(source, match) {
  const opening = source.indexOf("(", match.index);
  let parentheses = 0;
  let generics = 0;
  let commas = 0;
  let content = false;
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") parentheses += 1;
    if (character === ")" && parentheses > 0) parentheses -= 1;
    else if (character === ")" && parentheses === 0) return content ? commas + 1 : 0;
    if (character === "<") generics += 1;
    if (character === ">" && generics > 0) generics -= 1;
    if (character === "," && parentheses === 0 && generics === 0) commas += 1;
    if (!/\s/.test(character)) content = true;
  }
  throw new Error("production method parameters are unterminated");
}

function javaMethodDeclarations(source) {
  const declaration = /^[ \t]*(?!return\b|throw\b|new\b)(?:(?:public|protected|private|static|final|synchronized|abstract|native|default)[ \t]+|@[\w.]+(?:\([^\n)]*\))?[ \t]+)*(?:<[^\n>]+>[ \t]+)?[A-Za-z_$][\w$.\[\]]*(?:[ \t]*<[^\n;=(){}]+>)?[ \t]+([A-Za-z_$][\w$]*)[ \t]*\(/gm;
  return [...source.matchAll(declaration)].map((match) => match[1]);
}

export function discoverAuthorizationMethods(productionSources) {
  if (!Array.isArray(productionSources) || productionSources.length === 0) {
    throw new Error("production authorization source inventory is missing");
  }
  const signals = [
    /\bAuthorizationDecision\b/,
    /\bPASSWORD_CHANGE_REQUIRED\b/,
    /\.requireRecent\s*\(/,
    /\bRole\.ADMIN\b/,
    /\.requireEligible\s*\(/,
    /\.requireManagementAccess\s*\(/,
    /\brequireSameActor\s*\(/,
    /\bcurrentUser\.[A-Za-z][A-Za-z0-9_]*\s*\(/,
    /\.contains\s*\(\s*Role\.[A-Z_]+\s*\)/,
    /\.permitsManagement\s*\(/,
    /\b(?:reviewedBy|bookedBy)\s*\(\s*\)\s*\.equals\s*\(/,
    /\b(?:accountId|personId|actor|subjectId)\.equals\s*\(/,
    /\b(?:role|authority)\s*(?:==|!=)\s*Role\.[A-Z_]+/,
    /\bRole\.[A-Z_]+\s*(?:==|!=|\.equals\s*\()/,
    /\bswitch\s*\([^)]*\b(?:role|authority)\b[^)]*\)/i
  ];
  const authorizationAnnotations = new Set([
    "PreAuthorize", "PostAuthorize", "PreFilter", "PostFilter", "Secured", "RolesAllowed",
    "PermitAll", "DenyAll"
  ]);
  const discovered = [];
  for (const { path, source } of productionSources) {
    if (path.includes("/demo/") || path.includes("/performance/")
        || path.includes("/securityassessment/")) continue;
    for (const annotation of source.matchAll(/@([A-Za-z_$][\w$.]*)/g)) {
      const simpleName = annotation[1].split(".").at(-1);
      if (/(?:Authoriz|Secured|RolesAllowed|PermitAll|DenyAll)/.test(simpleName)
          && !authorizationAnnotations.has(simpleName)) {
        throw new Error(`unsupported security annotation @${annotation[1]} in ${path}`);
      }
    }
    const annotationTargets = authorizationAnnotationTargets(source, authorizationAnnotations);
    for (const symbol of new Set(javaMethodDeclarations(source))) {
      if (path.endsWith(`/${symbol}.java`) || !/^[a-z]/.test(symbol)) continue;
      const matches = javaMethodMatches(source, symbol);
      matches.forEach((match) => {
        let body;
        try {
          body = javaMethodAt(source, match, symbol);
        } catch (error) {
          if (/has no body/.test(error.message)) body = null;
          else throw error;
        }
        const annotated = annotationTargets.allMethods || annotationTargets.methods.has(symbol);
        if (!annotated && (body === null || !signals.some((signal) => signal.test(body)))) {
          return;
        }
        const suffix = matches.length === 1 ? symbol : `${symbol}/${javaMethodArity(source, match)}`;
        discovered.push(`${path}#${suffix}`);
      });
    }
  }
  return [...new Set(discovered)].toSorted();
}

function authorizationAnnotationTargets(source, knownAnnotations) {
  const methods = new Set();
  let allMethods = false;
  const annotations = /@([A-Za-z_$][\w$.]*)/g;
  for (const match of source.matchAll(annotations)) {
    const simpleName = match[1].split(".").at(-1);
    if (!knownAnnotations.has(simpleName)) continue;
    let cursor = annotationEnd(source, match.index + match[0].length);
    while (true) {
      cursor = skipWhitespace(source, cursor);
      if (/^(?:(?:public|protected|private|static|abstract|strictfp)\s+)*@interface\b/
        .test(source.slice(cursor))) {
        throw new Error(`security meta-annotation @${simpleName} is unsupported`);
      }
      if (source[cursor] !== "@") break;
      const following = /^@([A-Za-z_$][\w$.]*)/.exec(source.slice(cursor));
      if (!following) break;
      cursor = annotationEnd(source, cursor + following[0].length);
    }
    const declaration = source.slice(skipWhitespace(source, cursor));
    if (/^(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(?:class|interface|record|enum)\b/.test(declaration)) {
      allMethods = true;
      continue;
    }
    const method = /^(?:(?:public|protected|private|static|final|synchronized|abstract|native|default)\s+)*(?:<[^\n>]+>\s+)?[A-Za-z_$][\w$.\[\]]*(?:\s*<[^\n;=(){}]+>)?\s+([A-Za-z_$][\w$]*)\s*\(/.exec(declaration);
    if (method) methods.add(method[1]);
  }
  return { allMethods, methods };
}

function annotationEnd(source, afterName) {
  let cursor = skipWhitespace(source, afterName);
  if (source[cursor] !== "(") return cursor;
  let depth = 0;
  let quote = null;
  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote && source[cursor - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return cursor + 1;
  }
  throw new Error("security annotation has unterminated arguments");
}

function skipWhitespace(source, cursor) {
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function openApiFieldExists(api, reference) {
  const separator = reference.indexOf(".");
  if (separator < 1) return false;
  const schemaName = reference.slice(0, separator);
  const field = reference.slice(separator + 1);
  const schema = api.components?.schemas?.[schemaName];
  return schemaProperties(schema).has(field);
}

function operationFieldExists(api, operationId, access, reference) {
  if (!reference.startsWith("$request.")) return openApiFieldExists(api, reference);
  if (access === "read") return false;
  const field = reference.slice("$request.".length);
  const operation = openApiOperation(api, operationId);
  const requestBody = resolveComponent(api, operation?.requestBody);
  return Object.values(requestBody?.content ?? {})
    .some(({ schema }) => schemaProperties(schema).has(field));
}

function openApiOperation(api, operationId) {
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  return Object.values(api.paths ?? {}).flatMap((pathItem) => Object.entries(pathItem))
    .find(([method, candidate]) => methods.has(method) && candidate.operationId === operationId)?.[1];
}

function operationFieldInventory(api) {
  return operationFieldUses(api).map(({ key }) => key).toSorted();
}

function operationFieldUses(api) {
  const uses = [];
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || !operation.operationId) continue;
      const operationId = operation.operationId;
      for (const parameterReference of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
        const parameter = resolveComponent(api, parameterReference);
        const parameterPrefix = `${operationId}:parameter:${parameter.in}:${parameter.name}`;
        const parameterField = `$parameter.${parameter.in}.${parameter.name}`;
        uses.push({
          key: parameterPrefix,
          operationId,
          direction: "parameter",
          reference: parameterField
        });
        if (parameter.schema) {
          collectSchemaFieldUses(api, parameter.schema, `${parameterPrefix}:schema`, operationId,
            "parameter", parameterField, uses);
        }
        for (const [mediaType, media] of Object.entries(parameter.content ?? {})) {
          collectSchemaFieldUses(api, media.schema, `${parameterPrefix}:${mediaType}`, operationId,
            "parameter", parameterField, uses);
        }
      }
      const requestBody = operation.requestBody ? resolveComponent(api, operation.requestBody) : null;
      for (const [mediaType, media] of Object.entries(requestBody?.content ?? {})) {
        collectSchemaFieldUses(api, media.schema, `${operationId}:request:${mediaType}`,
          operationId, "request", "$request", uses);
      }
      for (const [status, responseReference] of Object.entries(operation.responses ?? {})) {
        const response = resolveComponent(api, responseReference);
        for (const [header, headerReference] of Object.entries(response?.headers ?? {})) {
          const resolvedHeader = resolveComponent(api, headerReference);
          const headerPrefix = `${operationId}:response:${status}:header:${header}`;
          const headerField = `$response.header.${header}`;
          uses.push({
            key: headerPrefix,
            operationId,
            direction: "response",
            reference: headerField
          });
          if (resolvedHeader.schema) {
            collectSchemaFieldUses(api, resolvedHeader.schema, `${headerPrefix}:schema`, operationId,
              "response", headerField, uses);
          }
          for (const [mediaType, media] of Object.entries(resolvedHeader.content ?? {})) {
            collectSchemaFieldUses(api, media.schema, `${headerPrefix}:${mediaType}`, operationId,
              "response", headerField, uses);
          }
        }
        for (const [mediaType, media] of Object.entries(response?.content ?? {})) {
          collectSchemaFieldUses(api, media.schema, `${operationId}:response:${status}:${mediaType}`,
            operationId, "response", "$response", uses);
        }
      }
    }
  }
  return uses;
}

export function authorizationFieldUses(api) {
  return operationFieldUses(api).map((use) => ({ ...use }));
}

export function authorizationFieldInventory(api) {
  return operationFieldInventory(api);
}

export function ordinaryAuthorizationFields(api, policy) {
  const uses = operationFieldUses(api);
  const protectedKeys = new Set();
  for (const rule of policy.fieldRules) {
    const direction = rule.access === "read" ? "response" : "request";
    for (const operationId of rule.operationIds) {
      for (const field of rule.fields) {
        uses.filter((use) => use.operationId === operationId
          && use.direction === direction && use.reference === field)
          .flatMap((match) => fieldUseAndDescendants(uses, match))
          .forEach((use) => protectedKeys.add(fieldClassificationKey(use)));
      }
    }
  }
  return [...new Set(uses.map(fieldClassificationKey))]
    .filter((key) => !protectedKeys.has(key)).toSorted();
}

function fieldUseAndDescendants(uses, parent) {
  return uses.filter((candidate) => candidate.operationId === parent.operationId
    && candidate.direction === parent.direction
    && (candidate.key === parent.key || candidate.key.startsWith(`${parent.key}:`)));
}

function fieldClassificationKey(use) {
  return use.reference.startsWith("Problem.")
    ? use.reference
    : `${use.operationId}:${use.direction}:${use.reference}`;
}

function collectSchemaFieldUses(api, node, prefix, operationId, direction, referencePrefix,
  uses, ancestors = new Set()) {
  if (!node || typeof node !== "object") return;
  const unsupportedApplicators = [
    "if", "then", "else", "dependentSchemas", "patternProperties", "prefixItems", "contains",
    "$defs", "definitions", "unevaluatedProperties", "not"
  ];
  const unsupported = unsupportedApplicators.find((keyword) => keyword in node);
  if (unsupported) {
    throw new Error(`unsupported OpenAPI schema keyword ${unsupported} at ${prefix}`);
  }
  if (node.$ref?.startsWith("#/components/schemas/")) {
    const schemaName = node.$ref.slice("#/components/schemas/".length);
    const referencedSchema = api.components?.schemas?.[schemaName];
    if (referencedSchema === undefined) {
      throw new Error(`OpenAPI schema reference ${node.$ref} does not resolve at ${prefix}`);
    }
    if (!ancestors.has(node.$ref)) {
      collectSchemaFieldUses(api, referencedSchema, prefix, operationId, direction,
        schemaName, uses, new Set([...ancestors, node.$ref]));
    }
    const siblings = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"));
    collectSchemaFieldUses(api, siblings, `${prefix}:ref-siblings`, operationId, direction,
      referencePrefix, uses, ancestors);
    return;
  }
  if (node.$ref) {
    throw new Error(`unsupported OpenAPI schema reference ${node.$ref} at ${prefix}`);
  }
  for (const [name, property] of Object.entries(node.properties ?? {})) {
    const key = `${prefix}:${name}`;
    const reference = `${referencePrefix}.${name}`;
    uses.push({ key, operationId, direction, reference });
    collectSchemaFieldUses(api, property, key, operationId, direction, reference, uses, ancestors);
  }
  if (node.items) collectSchemaFieldUses(api, node.items, `${prefix}:[]`, operationId, direction,
    `${referencePrefix}.items`, uses, ancestors);
  for (const part of node.allOf ?? []) collectSchemaFieldUses(api, part, prefix, operationId,
    direction, referencePrefix, uses, ancestors);
  for (const [index, part] of (node.oneOf ?? []).entries()) {
    collectSchemaFieldUses(api, part, `${prefix}:oneOf:${index}`, operationId,
      direction, referencePrefix, uses, ancestors);
  }
  for (const [index, part] of (node.anyOf ?? []).entries()) {
    collectSchemaFieldUses(api, part, `${prefix}:anyOf:${index}`, operationId,
      direction, referencePrefix, uses, ancestors);
  }
  if (node.additionalProperties === true || (node.additionalProperties
      && typeof node.additionalProperties === "object")) {
    const key = `${prefix}:additionalProperties:*`;
    const reference = `${referencePrefix}.*`;
    uses.push({ key, operationId, direction, reference });
    if (typeof node.additionalProperties === "object") {
      collectSchemaFieldUses(api, node.additionalProperties, key, operationId, direction,
        reference, uses, ancestors);
    }
  }
}

function resolveComponent(api, node, ancestors = new Set()) {
  if (!node?.$ref) return node;
  if (!node.$ref.startsWith("#/")) {
    throw new Error(`external OpenAPI reference ${node.$ref} is unsupported`);
  }
  if (ancestors.has(node.$ref)) {
    throw new Error(`cyclic OpenAPI reference ${node.$ref} is unsupported`);
  }
  const resolved = node.$ref.slice(2).split("/").reduce((value, segment) => value?.[segment], api);
  if (resolved === undefined) throw new Error(`OpenAPI reference ${node.$ref} does not resolve`);
  return {
    ...resolveComponent(api, resolved, new Set([...ancestors, node.$ref])),
    ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$ref"))
  };
}

function fingerprint(values) {
  return createHash("sha256").update(`${values.join("\n")}\n`).digest("hex");
}

export function authorizationFieldFingerprints(api, policy) {
  const protectedFields = [];
  for (const rule of policy.fieldRules) {
    for (const operationId of rule.operationIds) {
      for (const field of rule.fields) protectedFields.push(`${operationId}:${field}:${rule.access}`);
    }
  }
  return {
    openApiFieldInventorySha256: fingerprint(operationFieldInventory(api)),
    protectedFieldInventorySha256: fingerprint(protectedFields.toSorted())
  };
}

export function productionAuthorizationFingerprint(policy, readSource) {
  const paths = new Set(policy.decisions.flatMap(({ productionPaths }) => productionPaths)
    .map((anchor) => anchor.split("#")[0]));
  return fingerprint([...paths].toSorted().map((path) => `${path}\n${readSource(path)}`));
}

function schemaProperties(schema) {
  const properties = new Set(Object.keys(schema?.properties ?? {}));
  for (const part of schema?.allOf ?? []) {
    if (part.$ref) continue;
    for (const name of schemaProperties(part)) properties.add(name);
  }
  return properties;
}

function operationSchemaNames(api, operationId) {
  const operation = openApiOperation(api, operationId);
  const requestBody = operation?.requestBody ? resolveComponent(api, operation.requestBody) : null;
  const requestNodes = requestBody
    ? Object.values(requestBody.content ?? {}).map(({ schema }) => schema) : [];
  const responseNodes = Object.values(operation?.responses ?? {})
    .map((response) => resolveComponent(api, response))
    .flatMap(({ content = {} }) => Object.values(content).map(({ schema }) => schema));
  return {
    requests: reachableSchemas(api, requestNodes),
    responses: reachableSchemas(api, responseNodes)
  };
}

function reachableSchemas(api, nodes) {
  const names = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.$ref?.startsWith("#/components/schemas/")) {
      const name = node.$ref.slice("#/components/schemas/".length);
      if (names.has(name)) return;
      names.add(name);
      visit(api.components.schemas[name]);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  nodes.forEach(visit);
  return names;
}

function assertUniqueIds(entries, kind) {
  const seen = new Set();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`${kind} ${id} is duplicated`);
    seen.add(id);
  }
}

function assertSameMembers(actual, expected, message) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${message}: expected ${expected.join(", ")}; received ${actual.join(", ")}`);
  }
}

export function renderAuthorizationPolicy(policy) {
  const lines = [
    "# Authorization policy",
    "",
    "> Generated from `security/authorization-policy.json`; edit the maintained policy, not this file.",
    "",
    policy.purpose,
    "",
    "The maintained JSON classifies every reachable OpenAPI field either as ordinary or under one of the protected-field rules below. Ordinary fields inherit their operation rule without an additional ownership or workflow restriction. Fingerprints bind that classification and the named production authorization methods to the reviewed code.",
    "",
    "## Principals",
    "",
    "| Principal | Meaning |",
    "|---|---|",
    ...policy.principals.map(({ id, description }) => `| \`${id}\` | ${description} |`),
    "",
    "## Resource attributes",
    "",
    "| Attribute | Meaning |",
    "|---|---|",
    ...policy.attributes.map(({ id, description }) => `| \`${id}\` | ${description} |`),
    "",
    "## Operation rules",
    "",
    "| Rule | Operations | Admitted actors | Required decisions |",
    "|---|---|---|---|",
    ...policy.operationRules.map((rule) => `| \`${rule.id}\` | ${rule.operationIds.map(code).join(", ")} | ${rule.actors.map(code).join(", ")} | ${rule.decisions.map(code).join(", ")} |`),
    "",
    "## Authorization decisions",
    ""
  ];
  for (const decision of policy.decisions) {
    lines.push(`### ${decision.title}`, "", decision.rule, "", `Attributes: ${decision.attributes.map(code).join(", ")}.`, "",
      `Production: ${decision.productionPaths.map(code).join(", ")}.`, "",
      `Positive tests: ${decision.positiveTests.map(code).join(", ")}.`, "",
      `Negative tests: ${decision.negativeTests.map(code).join(", ")}.`, "");
  }
  lines.push("## Protected field rules", "", "| Rule | Access | Fields | Operations | Actors and attributes |",
    "|---|---|---|---|---|",
    ...policy.fieldRules.map((rule) => `| \`${rule.id}\` | ${rule.access} | ${rule.fields.map(code).join(", ")} | ${rule.operationIds.map(code).join(", ")} | ${rule.actors.map(code).join(", ")}; ${rule.attributes.map(code).join(", ")} |`),
    "", "Every field not declared by an operation's OpenAPI request schema is rejected before the operation runs. Every field not declared by its response schema is outside that operation's projection. The rules above name the fields whose visibility or mutability is narrower than merely satisfying that schema.", "");
  return lines.join("\n");
}

const code = (value) => `\`${value}\``;
