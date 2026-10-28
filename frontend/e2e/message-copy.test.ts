import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";
import de from "../src/locales/de";
import en from "../src/locales/en";

for (const [language, bundle] of Object.entries({ de, en })) {
  it(`given the API message kinds in ${language}, when their labels and summaries are resolved, then every kind has translated copy`, () => {
    // given
    const contract = parse(readFileSync("../src/main/resources/api/openapi.yaml", "utf8")) as {
      components: { schemas: { MessageKind: { enum: string[] } } };
    };

    // when
    const kinds = contract.components.schemas.MessageKind.enum;

    // then
    for (const kind of kinds) {
      expect((bundle as Record<string, string>)[`messages.kind.${kind}`], `${kind} has a label in ${language}`).toBeTruthy();
      expect((bundle as Record<string, string>)[`notifications.summary.${kind}`], `${kind} has a summary in ${language}`).toBeTruthy();
    }
  });
}
