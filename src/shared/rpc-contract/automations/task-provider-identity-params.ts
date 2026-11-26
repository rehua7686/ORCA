import * as z from 'zod'

// A GitHub identity is only usable with both fields present and non-blank.
const GithubIdentityField = z.string().refine((value) => value.trim().length > 0, {
  message: 'Required'
})

/** A task source's provider identity, keyed by provider. */
export const TaskProviderIdentity = z
  .discriminatedUnion('provider', [
    z
      .object({
        provider: z.literal('github'),
        // Reject blank identity without trimming: normalization treats it as absent, but parsing must preserve nonblank bytes.
        owner: GithubIdentityField,
        repo: GithubIdentityField,
        host: z.string().optional()
      })
      .passthrough(),
    z
      .object({
        provider: z.literal('gitlab'),
        projectId: z.string().nullable().optional(),
        namespace: z.string().nullable().optional(),
        project: z.string().nullable().optional(),
        webUrl: z.string().nullable().optional()
      })
      .passthrough(),
    z
      .object({
        provider: z.literal('linear'),
        workspaceId: z.string().nullable().optional(),
        workspaceName: z.string().nullable().optional(),
        teamId: z.string().nullable().optional(),
        teamKey: z.string().nullable().optional()
      })
      .passthrough(),
    z
      .object({
        provider: z.literal('jira'),
        siteId: z.string().nullable().optional(),
        siteUrl: z.string().nullable().optional(),
        projectKey: z.string().nullable().optional()
      })
      .passthrough(),
    z
      .object({
        provider: z.literal('gitea'),
        serverId: z.string().nullable().optional(),
        baseUrl: z.string().nullable().optional(),
        owner: z.string().nullable().optional(),
        repo: z.string().nullable().optional()
      })
      .passthrough()
  ])
  .optional()
  .nullable()
