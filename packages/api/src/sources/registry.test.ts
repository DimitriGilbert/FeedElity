import { describe, expect, test } from "bun:test";

import { createSourceAdapterRegistry, parseHttpUrl } from "./registry";
import type {
  DetectedSourceInput,
  SourceAdapter,
  SourceDetectionFailure,
  SourceDetectionSuccess,
} from "./types";

const alphaAdapter = createFakeAdapter({
  sourceType: "youtube",
  expectedHost: "alpha.example.test",
  inputKind: "feed-url",
});

const betaAdapter = createFakeAdapter({
  sourceType: "odysee",
  expectedHost: "beta.example.test",
  inputKind: "creator-url",
});

describe("source adapter registry", () => {
  test("dispatches detection to the first adapter that supports the input", () => {
    const registry = createSourceAdapterRegistry([alphaAdapter, betaAdapter]);

    const result = registry.detectSourceInput("https://beta.example.test/@creator");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toMatchObject({
      sourceType: "odysee",
      inputKind: "creator-url",
      canonicalInput: "https://beta.example.test/@creator",
    });
  });

  test("returns structured failure for unsupported inputs without throwing", () => {
    const registry = createSourceAdapterRegistry([alphaAdapter, betaAdapter]);

    const result = registry.detectSourceInput("https://unsupported.example.test/feed");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(`Expected unsupported input, received ${result.value.sourceType}.`);
    }
    expect(result.error).toEqual({
      code: "unsupported-source-input",
      message: "No registered source adapter supports this input.",
      input: "https://unsupported.example.test/feed",
    });
  });

  test("rejects duplicate source adapter registrations", () => {
    const registry = createSourceAdapterRegistry([alphaAdapter]);

    expect(() => registry.register(createFakeAdapter({
      sourceType: "youtube",
      expectedHost: "other.example.test",
      inputKind: "feed-url",
    }))).toThrow("Source adapter already registered for youtube.");
  });

  test("exposes registered adapters by source type", () => {
    const registry = createSourceAdapterRegistry([alphaAdapter]);

    expect(registry.getAdapter("youtube")).toBe(alphaAdapter);
    expect(registry.getAdapter("peertube")).toBeNull();
    expect(registry.listAdapters()).toEqual([alphaAdapter]);
  });
});

describe("source URL validation", () => {
  test("accepts only http and https URLs", () => {
    const httpsResult = parseHttpUrl("https://alpha.example.test/feed");
    const ftpResult = parseHttpUrl("ftp://alpha.example.test/feed");
    const invalidResult = parseHttpUrl("not a url");

    expect(httpsResult.ok).toBe(true);
    expect(ftpResult.ok).toBe(false);
    expect(invalidResult.ok).toBe(false);
  });
});

interface FakeAdapterConfig {
  readonly sourceType: SourceAdapter["sourceType"];
  readonly expectedHost: string;
  readonly inputKind: DetectedSourceInput["inputKind"];
}

function createFakeAdapter(config: FakeAdapterConfig): SourceAdapter {
  return {
    sourceType: config.sourceType,
    detect(input) {
      const urlResult = parseHttpUrl(input);
      if (!urlResult.ok) {
        return unsupported(input);
      }
      if (urlResult.value.hostname !== config.expectedHost) {
        return unsupported(input);
      }
      return detected({
        sourceType: config.sourceType,
        inputKind: config.inputKind,
        originalInput: input,
        canonicalInput: urlResult.value.toString(),
      });
    },
    async resolveInput(input) {
      return {
        ok: true,
        value: {
          sourceType: input.sourceType,
          sourceExternalId: `${input.sourceType}:resolved`,
          canonicalUrl: input.canonicalInput,
        },
      };
    },
    normalizeCatalogPayload() {
      return {
        ok: true,
        value: {
          creator: {
            sourceType: config.sourceType,
            sourceExternalId: `${config.sourceType}:creator`,
            displayName: "Fixture creator",
          },
          feeds: [],
          items: [],
        },
      };
    },
    async fetchCatalog() {
      return {
        ok: true,
        value: {
          creator: {
            sourceType: config.sourceType,
            sourceExternalId: `${config.sourceType}:creator`,
            displayName: "Fixture creator",
          },
          feeds: [],
          items: [],
        },
      };
    },
  };
}

function detected(value: DetectedSourceInput): SourceDetectionSuccess {
  return { ok: true, value };
}

function unsupported(input: string): SourceDetectionFailure {
  return {
    ok: false,
    error: {
      code: "unsupported-source-input",
      message: "Fake adapter does not support this input.",
      input,
    },
  };
}
