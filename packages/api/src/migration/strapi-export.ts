import { z } from "zod";

const strapiEntityIdSchema = z.number().int().positive();
const nonEmptyStringSchema = z.string().min(1);
const nullableTextSchema = z.string().nullable();
const optionalNullableTextSchema = z.string().nullable().optional();
const sourceTypeSchema = z.enum(["youtube", "odysee", "peertube", "unknown"]);
const statusOptionNameSchema = z.enum(["open", "opened", "played", "favorite"]);
const expectedCollectionNames = [
  "users",
  "creators",
  "creator_options",
  "feeds",
  "feed_options",
  "feed_contents",
  "creator_contents",
  "content_options",
  "subscriptions",
  "subscription_options",
  "subscription_content_options",
  "playlists",
  "playlist_contents",
] as const;

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected a parseable timestamp string.",
});

const strapiAuditFieldsSchema = z.object({
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
  publishedAt: timestampSchema.nullable().optional(),
});

const optionValueSemanticsSchema = z.object({
  statusName: statusOptionNameSchema,
  active: z.boolean(),
});

const optionFieldsSchema = z.object({
  name: nonEmptyStringSchema,
  type: nonEmptyStringSchema,
  value: z.string(),
});

const strapiUserSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    username: nonEmptyStringSchema,
    email: z.string().email(),
    provider: nonEmptyStringSchema,
    confirmed: z.boolean(),
    blocked: z.boolean(),
  })
  .strict();

const strapiCreatorSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    name: nonEmptyStringSchema,
    description: nullableTextSchema,
  })
  .strict();

const strapiCreatorOptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    creatorId: strapiEntityIdSchema,
  })
  .merge(optionFieldsSchema)
  .strict();

const strapiFeedSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    creatorId: strapiEntityIdSchema,
    name: nonEmptyStringSchema,
    url: z.string().url(),
    type: sourceTypeSchema,
    externalId: nonEmptyStringSchema,
    refreshedAt: timestampSchema.nullable(),
  })
  .strict();

const strapiFeedOptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    feedId: strapiEntityIdSchema,
  })
  .merge(optionFieldsSchema)
  .strict();

const strapiCreatorContentSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    creatorId: strapiEntityIdSchema,
    title: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    publication: timestampSchema.nullable(),
    data: nullableTextSchema,
  })
  .strict();

const strapiFeedContentSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    feedId: strapiEntityIdSchema,
    contentId: strapiEntityIdSchema,
    externalId: nonEmptyStringSchema,
    raw: optionalNullableTextSchema,
  })
  .strict();

const strapiContentOptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    contentId: strapiEntityIdSchema,
    interpretedStatus: optionValueSemanticsSchema.optional(),
  })
  .merge(optionFieldsSchema)
  .strict();

const strapiSubscriptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    userId: strapiEntityIdSchema,
    creatorId: strapiEntityIdSchema,
  })
  .strict();

const strapiSubscriptionOptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    subscriptionId: strapiEntityIdSchema,
  })
  .merge(optionFieldsSchema)
  .strict();

const strapiSubscriptionContentOptionSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    subscriptionId: strapiEntityIdSchema,
    contentId: strapiEntityIdSchema,
    interpretedStatus: optionValueSemanticsSchema,
  })
  .merge(optionFieldsSchema)
  .strict();

const strapiPlaylistSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    userId: strapiEntityIdSchema,
    name: nonEmptyStringSchema,
    description: nullableTextSchema,
  })
  .strict();

const strapiPlaylistContentSchema = strapiAuditFieldsSchema
  .extend({
    oldId: strapiEntityIdSchema,
    playlistId: strapiEntityIdSchema,
    contentId: strapiEntityIdSchema,
    Added: timestampSchema.nullable(),
    position: z.number().int().nonnegative(),
  })
  .strict();

const strapiExportMetadataSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: timestampSchema,
    source: z
      .object({
        application: z.literal("feedelity-strapi"),
        strapiVersion: nonEmptyStringSchema,
        sourceInstanceId: nonEmptyStringSchema,
      })
      .strict(),
    fingerprintInputs: z
      .object({
        schemaVersion: nonEmptyStringSchema,
        collectionNames: z.array(z.enum(expectedCollectionNames)).length(expectedCollectionNames.length).superRefine((names, context) => {
          names.forEach((name, index) => {
            if (name !== expectedCollectionNames[index]) {
              context.addIssue({
                code: "custom",
                message: `Expected collectionNames[${index}] to be ${expectedCollectionNames[index]}.`,
                path: [index],
              });
            }
          });
        }),
      })
      .strict(),
  })
  .strict();

export const strapiExportSchema = z
  .object({
    metadata: strapiExportMetadataSchema,
    users: z.array(strapiUserSchema),
    creators: z.array(strapiCreatorSchema),
    creatorOptions: z.array(strapiCreatorOptionSchema),
    feeds: z.array(strapiFeedSchema),
    feedOptions: z.array(strapiFeedOptionSchema),
    feedContents: z.array(strapiFeedContentSchema),
    creatorContents: z.array(strapiCreatorContentSchema),
    contentOptions: z.array(strapiContentOptionSchema),
    subscriptions: z.array(strapiSubscriptionSchema),
    subscriptionOptions: z.array(strapiSubscriptionOptionSchema),
    subscriptionContentOptions: z.array(strapiSubscriptionContentOptionSchema),
    playlists: z.array(strapiPlaylistSchema),
    playlistContents: z.array(strapiPlaylistContentSchema),
  })
  .strict()
  .superRefine((exportData, context) => {
    addUniqueOldIdIssues(context, "users", exportData.users);
    addUniqueOldIdIssues(context, "creators", exportData.creators);
    addUniqueOldIdIssues(context, "creatorOptions", exportData.creatorOptions);
    addUniqueOldIdIssues(context, "feeds", exportData.feeds);
    addUniqueOldIdIssues(context, "feedOptions", exportData.feedOptions);
    addUniqueOldIdIssues(context, "feedContents", exportData.feedContents);
    addUniqueOldIdIssues(context, "creatorContents", exportData.creatorContents);
    addUniqueOldIdIssues(context, "contentOptions", exportData.contentOptions);
    addUniqueOldIdIssues(context, "subscriptions", exportData.subscriptions);
    addUniqueOldIdIssues(context, "subscriptionOptions", exportData.subscriptionOptions);
    addUniqueOldIdIssues(context, "subscriptionContentOptions", exportData.subscriptionContentOptions);
    addUniqueOldIdIssues(context, "playlists", exportData.playlists);
    addUniqueOldIdIssues(context, "playlistContents", exportData.playlistContents);

    const userIds = collectOldIds(exportData.users);
    const creatorIds = collectOldIds(exportData.creators);
    const feedIds = collectOldIds(exportData.feeds);
    const contentIds = collectOldIds(exportData.creatorContents);
    const subscriptionIds = collectOldIds(exportData.subscriptions);
    const playlistIds = collectOldIds(exportData.playlists);

    addReferenceIssues(context, "creatorOptions", "creatorId", exportData.creatorOptions, creatorIds);
    addReferenceIssues(context, "feeds", "creatorId", exportData.feeds, creatorIds);
    addReferenceIssues(context, "feedOptions", "feedId", exportData.feedOptions, feedIds);
    addReferenceIssues(context, "feedContents", "feedId", exportData.feedContents, feedIds);
    addReferenceIssues(context, "feedContents", "contentId", exportData.feedContents, contentIds);
    addReferenceIssues(context, "creatorContents", "creatorId", exportData.creatorContents, creatorIds);
    addReferenceIssues(context, "contentOptions", "contentId", exportData.contentOptions, contentIds);
    addReferenceIssues(context, "subscriptions", "userId", exportData.subscriptions, userIds);
    addReferenceIssues(context, "subscriptions", "creatorId", exportData.subscriptions, creatorIds);
    addReferenceIssues(context, "subscriptionOptions", "subscriptionId", exportData.subscriptionOptions, subscriptionIds);
    addReferenceIssues(
      context,
      "subscriptionContentOptions",
      "subscriptionId",
      exportData.subscriptionContentOptions,
      subscriptionIds,
    );
    addReferenceIssues(context, "subscriptionContentOptions", "contentId", exportData.subscriptionContentOptions, contentIds);
    addReferenceIssues(context, "playlists", "userId", exportData.playlists, userIds);
    addReferenceIssues(context, "playlistContents", "playlistId", exportData.playlistContents, playlistIds);
    addReferenceIssues(context, "playlistContents", "contentId", exportData.playlistContents, contentIds);
  });

export type StrapiExport = z.infer<typeof strapiExportSchema>;
export type StrapiExportMetadata = z.infer<typeof strapiExportMetadataSchema>;
export type StrapiUser = z.infer<typeof strapiUserSchema>;
export type StrapiCreator = z.infer<typeof strapiCreatorSchema>;
export type StrapiCreatorOption = z.infer<typeof strapiCreatorOptionSchema>;
export type StrapiFeed = z.infer<typeof strapiFeedSchema>;
export type StrapiFeedOption = z.infer<typeof strapiFeedOptionSchema>;
export type StrapiFeedContent = z.infer<typeof strapiFeedContentSchema>;
export type StrapiCreatorContent = z.infer<typeof strapiCreatorContentSchema>;
export type StrapiContentOption = z.infer<typeof strapiContentOptionSchema>;
export type StrapiSubscription = z.infer<typeof strapiSubscriptionSchema>;
export type StrapiSubscriptionOption = z.infer<typeof strapiSubscriptionOptionSchema>;
export type StrapiSubscriptionContentOption = z.infer<typeof strapiSubscriptionContentOptionSchema>;
export type StrapiPlaylist = z.infer<typeof strapiPlaylistSchema>;
export type StrapiPlaylistContent = z.infer<typeof strapiPlaylistContentSchema>;

interface OldIdRecord {
  readonly oldId: number;
}

function collectOldIds(records: readonly OldIdRecord[]): Set<number> {
  return new Set(records.map((record) => record.oldId));
}

function addUniqueOldIdIssues(context: z.RefinementCtx, collectionName: string, records: readonly OldIdRecord[]): void {
  const seenIds = new Set<number>();
  records.forEach((record, index) => {
    if (seenIds.has(record.oldId)) {
      context.addIssue({
        code: "custom",
        message: `${collectionName} contains duplicate oldId ${record.oldId}.`,
        path: [collectionName, index, "oldId"],
      });
      return;
    }
    seenIds.add(record.oldId);
  });
}

function addReferenceIssues<FieldName extends string>(
  context: z.RefinementCtx,
  collectionName: string,
  fieldName: FieldName,
  records: readonly (OldIdRecord & Record<FieldName, number>)[],
  targetIds: ReadonlySet<number>,
): void {
  records.forEach((record, index) => {
    const targetId = record[fieldName];
    if (!targetIds.has(targetId)) {
      context.addIssue({
        code: "custom",
        message: `${collectionName}.${fieldName} references missing oldId ${targetId}.`,
        path: [collectionName, index, fieldName],
      });
    }
  });
}
