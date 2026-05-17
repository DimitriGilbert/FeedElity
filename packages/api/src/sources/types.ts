import type { ContentType, SourceIdentity, SourceType } from "../domain/catalog";
import type {
  LinkFeedContentInput,
  SaveContentItemInput,
  SaveContentSourceInput,
  SaveCreatorInput,
  SaveFeedInput,
} from "../repositories/catalog";

export type SourceAdapterResult<TValue> = SourceAdapterSuccess<TValue> | SourceAdapterFailure;

export interface SourceAdapterSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export interface SourceAdapterFailure {
  readonly ok: false;
  readonly error: SourceAdapterError;
}

export type SourceAdapterErrorCode =
  | "invalid-source-input"
  | "unsupported-source-input"
  | "remote-fetch-failed"
  | "remote-payload-invalid"
  | "normalization-failed";

export interface SourceAdapterError {
  readonly code: SourceAdapterErrorCode;
  readonly message: string;
  readonly input?: string;
  readonly sourceType?: SourceType;
  readonly httpStatus?: number;
  readonly cause?: unknown;
}

export type SourceDetectionResult = SourceDetectionSuccess | SourceDetectionFailure;

export interface SourceDetectionSuccess {
  readonly ok: true;
  readonly value: DetectedSourceInput;
}

export interface SourceDetectionFailure {
  readonly ok: false;
  readonly error: SourceAdapterError & { readonly code: "invalid-source-input" | "unsupported-source-input" };
}

export type SourceInputKind = "feed-url" | "creator-url" | "content-url" | "unknown-url";

export interface DetectedSourceInput {
  readonly sourceType: SourceType;
  readonly inputKind: SourceInputKind;
  readonly originalInput: string;
  readonly canonicalInput: string;
}

export interface ResolvedSourceInput extends SourceIdentity {
  readonly canonicalUrl: string;
  readonly title?: string | null;
}

export type NormalizedCreatorInput = SaveCreatorInput;

export type NormalizedFeedInput = Omit<SaveFeedInput, "creatorId">;

export type NormalizedContentItemInput = Omit<SaveContentItemInput, "creatorId"> & {
  readonly contentType?: ContentType;
};

export type NormalizedContentSourceInput = Omit<SaveContentSourceInput, "contentItemId">;

export type NormalizedFeedContentInput = Omit<LinkFeedContentInput, "feedId" | "contentItemId">;

export interface NormalizedCatalogContentItem {
  readonly contentItem: NormalizedContentItemInput;
  readonly feedContent: NormalizedFeedContentInput;
  readonly sources: readonly NormalizedContentSourceInput[];
}

export interface NormalizedCatalogPayload {
  readonly creator: NormalizedCreatorInput;
  readonly feeds: readonly NormalizedFeedInput[];
  readonly items: readonly NormalizedCatalogContentItem[];
}

export interface SourceAdapter<TSourceType extends SourceType = SourceType> {
  readonly sourceType: TSourceType;
  detect(input: string): SourceDetectionResult;
  resolveInput(input: DetectedSourceInput & { readonly sourceType: TSourceType }): Promise<SourceAdapterResult<ResolvedSourceInput>>;
  normalizeCatalogPayload(
    input: ResolvedSourceInput & { readonly sourceType: TSourceType },
    payload: string,
  ): SourceAdapterResult<NormalizedCatalogPayload>;
  fetchCatalog(input: ResolvedSourceInput & { readonly sourceType: TSourceType }): Promise<SourceAdapterResult<NormalizedCatalogPayload>>;
}
