import { expect, it, vi } from "vitest";
import { parse } from "yaml";
import de from "./de";
import en from "./en";

for (const [language, bundle] of Object.entries({ de, en })) {
  it(`given the API message kinds in ${language}, when their labels and summaries are resolved, then every kind has translated copy`, async () => {
    // given
    const { readFileSync } = await vi.importActual<{ readFileSync: (path: string, encoding: "utf8") => string }>("node:fs");
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
