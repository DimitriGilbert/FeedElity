import type { SourceType } from "../domain/catalog";
import type {
  SourceAdapter,
  SourceAdapterResult,
  SourceDetectionFailure,
  SourceDetectionResult,
} from "./types";

export class SourceAdapterRegistry {
  private readonly adaptersBySourceType = new Map<SourceType, SourceAdapter>();

  constructor(adapters: readonly SourceAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: SourceAdapter): void {
    if (this.adaptersBySourceType.has(adapter.sourceType)) {
      throw new Error(`Source adapter already registered for ${adapter.sourceType}.`);
    }
    this.adaptersBySourceType.set(adapter.sourceType, adapter);
  }

  getAdapter(sourceType: SourceType): SourceAdapter | null {
    return this.adaptersBySourceType.get(sourceType) ?? null;
  }

  listAdapters(): readonly SourceAdapter[] {
    return [...this.adaptersBySourceType.values()];
  }

  detectSourceInput(input: string): SourceDetectionResult {
    const urlResult = parseHttpUrl(input);
    if (!urlResult.ok) {
      return detectionFailure("invalid-source-input", urlResult.error.message, input);
    }

    for (const adapter of this.adaptersBySourceType.values()) {
      const result = adapter.detect(input);
      if (result.ok) {
        return result;
      }
      if (result.error.code === "invalid-source-input") {
        return result;
      }
    }

    return detectionFailure("unsupported-source-input", "No registered source adapter supports this input.", input);
  }
}

export function createSourceAdapterRegistry(adapters: readonly SourceAdapter[] = []): SourceAdapterRegistry {
  return new SourceAdapterRegistry(adapters);
}

export function parseHttpUrl(input: string): SourceAdapterResult<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: "invalid-source-input",
        message: "Source input must be an absolute URL.",
        input,
        cause: error,
      },
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: {
        code: "invalid-source-input",
        message: "Source URL must use http or https.",
        input,
      },
    };
  }

  return { ok: true, value: url };
}

function detectionFailure(
  code: SourceDetectionFailure["error"]["code"],
  message: string,
  input: string,
): SourceDetectionFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      input,
    },
  };
}
