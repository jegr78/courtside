import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(new URL("../quality/risk-register.schema.json", import.meta.url), "utf8"));
const gapStartMarker = "<!-- automation-gap-register:start -->";
const gapEndMarker = "<!-- automation-gap-register:end -->";

function schemaTarget(reference) {
  if (!reference.startsWith("#/$defs/")) throw new Error(`Unsupported schema reference ${reference}`);
  return schema.$defs[reference.slice("#/$defs/".length)];
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function validateSchema(value, rule, path = "$") {
  if (rule.$ref) return validateSchema(value, schemaTarget(rule.$ref), path);
  if (rule.const !== undefined && value !== rule.const) throw new Error(`${path} violates schema const`);
  if (rule.enum && !rule.enum.includes(value)) throw new Error(`${path} violates schema enum`);
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => matchesType(value, type))) throw new Error(`${path} violates schema type`);
  }
  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) throw new Error(`${path} violates schema length`);
    if (rule.pattern && !new RegExp(rule.pattern, "u").test(value)) throw new Error(`${path} violates schema pattern`);
  }
  if (typeof value === "number" && rule.minimum !== undefined && value < rule.minimum) {
    throw new Error(`${path} violates schema minimum`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) throw new Error(`${path} violates schema item count`);
    if (rule.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
      throw new Error(`${path} violates schema uniqueness`);
    }
    value.forEach((entry, index) => validateSchema(entry, rule.items, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of rule.required ?? []) {
      if (!Object.hasOwn(value, required)) throw new Error(`${path} violates schema required field ${required}`);
    }
    if (rule.additionalProperties === false) {
      const unexpected = Object.keys(value).find((key) => !Object.hasOwn(rule.properties ?? {}, key));
      if (unexpected) throw new Error(`${path}.${unexpected} violates closed schema`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (rule.properties?.[key]) validateSchema(entry, rule.properties[key], `${path}.${key}`);
    }
  }
}

function safeMarkdown(value, context) {
  if (/[\r\n|<>]/u.test(value) || value.includes("<!-- risk-register:")) {
    throw new Error(`${context} contains unsafe generated Markdown`);
  }
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(value)
    || /\b(?:Bearer\s+)?[A-Za-z0-9_=-]{32,}\b/u.test(value)) {
    throw new Error(`${context} contains credential or personal-data shaped text`);
  }
  return value;
}

function replaceGenerated(source, start, end, content) {
  const starts = source.split(start).length - 1;
  const ends = source.split(end).length - 1;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (starts !== 1 || ends !== 1 || startIndex >= endIndex) {
    throw new Error(`Invalid generated markers ${start} and ${end}`);
  }
  return `${source.slice(0, startIndex)}${start}\n${content}\n${end}${source.slice(endIndex + end.length)}`;
}

function areaMarker(area, boundary) {
  const slug = area.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `<!-- risk-register:${slug}:${boundary} -->`;
}

function riskTable(area) {
  safeMarkdown(area.name, `Risk area ${area.name}`);
  const header = "| ID | Impact | Likelihood | Invariant | Positive boundaries | Negative boundaries | Level | Frequency | Environment | Synthetic data | Evidence | Owner | Open gap |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = area.risks.map((risk) => {
    for (const value of [risk.invariant, risk.positiveBoundaries, risk.negativeBoundaries, risk.level,
      risk.environment, risk.syntheticData, risk.evidenceType, risk.owner, risk.openGap].filter((entry) => entry !== null)) {
      safeMarkdown(value, `Risk ${risk.id}`);
    }
    return `| ${risk.id} | ${risk.impact} | ${risk.likelihood} | ${risk.invariant} | ${risk.positiveBoundaries} | ${risk.negativeBoundaries} | ${risk.level} | ${risk.frequency.join(", ")} | ${risk.environment} | ${risk.syntheticData} | ${risk.evidenceType} | ${risk.owner} | ${risk.openGap ?? "None."} |`;
  });
  return `### ${area.name}\n\n${header}\n${divider}\n${rows.join("\n")}`;
}

function gapTable(register) {
  const header = "| ID | Risks | Gap | Owner | Decision | Issue |";
  const divider = "|---|---|---|---|---|---|";
  const rows = register.automationGaps.map((gap) => {
    for (const value of [gap.summary, gap.owner, gap.decision]) safeMarkdown(value, `Automation gap ${gap.id}`);
    return `| ${gap.id} | ${gap.riskIds.join(", ")} | ${gap.summary} | ${gap.owner} | ${gap.decision} | [#${gap.issue}](https://github.com/jegr78/courtside/issues/${gap.issue}) |`;
  });
  return [header, divider, ...rows].join("\n");
}

export function renderQualityStrategy(source, register) {
  const risks = register.areas.reduce((rendered, area) => replaceGenerated(rendered,
    areaMarker(area.name, "start"), areaMarker(area.name, "end"), riskTable(area)), source);
  return replaceGenerated(risks, gapStartMarker, gapEndMarker, gapTable(register));
}

export function validateRiskRegister(register, { catalog, exceptions }) {
  validateSchema(register, schema);
  const areaNames = register.areas.map((area) => area.name);
  if (new Set(areaNames).size !== areaNames.length) throw new Error("Duplicate risk area in risk register");
  for (const area of areaNames) safeMarkdown(area, `Risk area ${area}`);
  const areaMarkers = areaNames.map((area) => areaMarker(area, "start"));
  if (new Set(areaMarkers).size !== areaMarkers.length) throw new Error("Duplicate generated risk area marker");
  const risks = register.areas.flatMap((area) => area.risks);
  const riskIds = risks.map((risk) => risk.id);
  const uniqueRiskIds = new Set(riskIds);
  if (uniqueRiskIds.size !== riskIds.length) throw new Error("Duplicate risk ID in risk register");
  const acceptances = new Map((exceptions.riskAcceptances ?? []).map((entry) => [entry.id, entry]));
  if (acceptances.size !== (exceptions.riskAcceptances ?? []).length) throw new Error("Duplicate risk acceptance ID");
  const referencedAcceptances = new Set();
  for (const risk of risks) {
    for (const value of [
      risk.invariant, risk.positiveBoundaries, risk.negativeBoundaries, risk.level, risk.environment,
      risk.syntheticData, risk.evidenceType, risk.owner, risk.openGap
    ].filter((entry) => entry !== null)) {
      safeMarkdown(value, `Risk ${risk.id}`);
    }
    for (const id of risk.acceptanceIds ?? []) {
      if (!acceptances.has(id)) throw new Error(`Risk ${risk.id} references unknown acceptance ${id}`);
      referencedAcceptances.add(id);
    }
  }
  for (const acceptance of acceptances.values()) {
    if (!referencedAcceptances.has(acceptance.id)) {
      throw new Error(`Risk acceptance ${acceptance.id} has no quality risk relationship`);
    }
  }
  const gapIds = register.automationGaps.map((gap) => gap.id);
  if (new Set(gapIds).size !== gapIds.length) throw new Error("Duplicate automation gap ID");
  for (const gap of register.automationGaps) {
    for (const value of [gap.summary, gap.owner, gap.decision]) safeMarkdown(value, `Automation gap ${gap.id}`);
    for (const id of gap.riskIds) {
      if (!uniqueRiskIds.has(id)) throw new Error(`Automation gap ${gap.id} references unknown risk ID ${id}`);
    }
  }
  const assessedSurfaces = new Set();
  for (const assessment of catalog.tests) {
    if (!Array.isArray(assessment.qualityRiskIds) || assessment.qualityRiskIds.length === 0) {
      throw new Error(`Assessment ${assessment.id} has no quality risk relationship`);
    }
    for (const id of assessment.qualityRiskIds) {
      if (!uniqueRiskIds.has(id)) throw new Error(`Assessment ${assessment.id} references unknown risk ID ${id}`);
    }
    assessedSurfaces.add(assessment.surface);
  }
  for (const surface of catalog.threatModel.surfaces) {
    if (!assessedSurfaces.has(surface.id)) throw new Error(`Product surface ${surface.id} has no risk-related assessment`);
  }
  return { riskCount: risks.length, riskIds: [...uniqueRiskIds].sort() };
}

function registerSources(repository) {
  return {
    register: JSON.parse(readFileSync(resolve(repository, "quality/risk-register.json"), "utf8")),
    catalog: JSON.parse(readFileSync(resolve(repository, "security/assessment-catalog.json"), "utf8")),
    exceptions: JSON.parse(readFileSync(resolve(repository, "security/exceptions.json"), "utf8"))
  };
}

export function checkRiskRegister(repository = root) {
  const { register, catalog, exceptions } = registerSources(repository);
  const strategyPath = resolve(repository, "docs/quality-strategy.md");
  const strategy = readFileSync(strategyPath, "utf8");
  const validation = validateRiskRegister(register, { catalog, exceptions });
  const rendered = renderQualityStrategy(strategy, register);
  if (rendered !== strategy) throw new Error("docs/quality-strategy.md differs from the risk register; run risk-register.mjs --write");
  return validation;
}

function main() {
  const { register, catalog, exceptions } = registerSources(root);
  validateRiskRegister(register, { catalog, exceptions });
  const strategyPath = resolve(root, "docs/quality-strategy.md");
  const strategy = readFileSync(strategyPath, "utf8");
  const rendered = renderQualityStrategy(strategy, register);
  if (process.argv.includes("--write")) writeFileSync(strategyPath, rendered);
  else if (process.argv.includes("--check")) {
    if (rendered !== strategy) throw new Error("docs/quality-strategy.md differs from the risk register; run risk-register.mjs --write");
  } else throw new Error("Use --check or --write");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
