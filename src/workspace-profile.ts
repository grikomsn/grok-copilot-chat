import { DEFAULT_XAI_PROFILE, normalizeProfileId } from "./auth/oauth";

/**
 * Where a profile binding was resolved from.
 *
 * - `entry` is the profile stored in the Manage Language Models entry.
 * - `folder` and `workspace` come from workspace-scoped settings. They bind an
 *   account to a repository or workspace and override the entry.
 * - `user` comes from the user settings. It acts as the default account for
 *   entries that do not name a profile of their own.
 */
export type ProfileBindingSource = "entry" | "folder" | "workspace" | "user";

/** Profile bindings contributed by one workspace folder. */
export interface ProfileScopeValues {
  /** Folder-scoped shorthand, for example `.vscode/settings.json`. */
  readonly folder?: string | undefined;
  /** Workspace-scoped shorthand, for example a `.code-workspace` file. */
  readonly workspace?: string | undefined;
  /** User-scoped shorthand, for example the user `settings.json`. */
  readonly user?: string | undefined;
  /** Folder-scoped per-entry overrides. */
  readonly folderMap?: Readonly<Record<string, string>> | undefined;
  /** Workspace-scoped per-entry overrides. */
  readonly workspaceMap?: Readonly<Record<string, string>> | undefined;
  /** User-scoped per-entry overrides. */
  readonly userMap?: Readonly<Record<string, string>> | undefined;
}

export interface ProfileResolution {
  /** The xAI profile that Grok requests should use. */
  readonly profile: string;
  /** Where the profile was resolved from. */
  readonly source: ProfileBindingSource;
  /** Whether a binding chose the profile over the entry's own profile. */
  readonly bound: boolean;
  /** Bindings whose configured value was not a valid profile ID. */
  readonly invalid: readonly ProfileBindingSource[];
}

type Classified = "unset" | "invalid" | string;

/** Classifies a configured binding value without throwing on malformed input. */
function classify(value: unknown): Classified {
  if (typeof value !== "string") return "unset";
  const trimmed = value.trim();
  if (!trimmed) return "unset";
  try {
    return normalizeProfileId(trimmed);
  } catch {
    return "invalid";
  }
}

function normalizeEntryProfile(entryProfile: string): string {
  try {
    return normalizeProfileId(entryProfile);
  } catch {
    return DEFAULT_XAI_PROFILE;
  }
}

/**
 * Reads a per-entry override map and validates both keys and values.
 *
 * Malformed entries are dropped so one bad value cannot break the whole
 * binding. Returns the valid overrides and whether any value was rejected.
 */
export function classifyProfileMap(
  value: unknown,
): { readonly overrides: Readonly<Record<string, string>>; readonly invalid: boolean } {
  const overrides: Record<string, string> = {};
  let invalid = false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { overrides, invalid };
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    let entry: string;
    try {
      entry = normalizeProfileId(key);
    } catch {
      invalid = true;
      continue;
    }
    const classified = classify(raw);
    if (classified === "invalid") {
      invalid = true;
      continue;
    }
    if (classified === "unset") continue;
    overrides[entry] = classified;
  }
  return { overrides, invalid };
}

/**
 * Resolves the xAI profile for a Manage Language Models entry.
 *
 * A per-entry override map is the most explicit binding and always wins. The
 * shorthand binds the default entry only, so a repository that pins an account
 * does not silently repoint an entry the user named after another account.
 * The user scope is honoured in every workspace because the user controls it;
 * folder and workspace scopes are honoured only in a trusted workspace
 * because the repository controls those.
 *
 * When several folders are open, the first folder that defines a binding
 * wins, so the result stays stable for a given window.
 */
export function resolveProfileBinding(
  entryProfile: string,
  scopes: readonly ProfileScopeValues[],
  options: { readonly trusted: boolean } = { trusted: true },
): ProfileResolution {
  const invalid: ProfileBindingSource[] = [];
  const entry = normalizeEntryProfile(entryProfile);
  const isDefaultEntry = entry === DEFAULT_XAI_PROFILE;

  const note = (source: ProfileBindingSource): void => {
    if (!invalid.includes(source)) invalid.push(source);
  };

  const mapScopes: ReadonlyArray<readonly [ProfileBindingSource, "folderMap" | "workspaceMap" | "userMap"]> = [
    ["folder", "folderMap"],
    ["workspace", "workspaceMap"],
    ["user", "userMap"],
  ];

  for (const [source, key] of mapScopes) {
    if (source !== "user" && !options.trusted) continue;
    for (const scope of scopes) {
      const map = scope[key];
      if (!map) continue;
      const override = map[entry];
      if (override === undefined) continue;
      const classified = classify(override);
      if (classified === "invalid") {
        note(source);
        continue;
      }
      if (classified === "unset") continue;
      return { profile: classified, source, bound: true, invalid };
    }
  }

  const shorthandScopes: ReadonlyArray<readonly [ProfileBindingSource, "folder" | "workspace" | "user"]> = [
    ["folder", "folder"],
    ["workspace", "workspace"],
    ["user", "user"],
  ];

  for (const [source, key] of shorthandScopes) {
    if (!isDefaultEntry) break;
    if (source !== "user" && !options.trusted) continue;
    for (const scope of scopes) {
      const classified = classify(scope[key]);
      if (classified === "invalid") {
        note(source);
        continue;
      }
      if (classified === "unset") continue;
      return { profile: classified, source, bound: true, invalid };
    }
  }

  return { profile: entry, source: "entry", bound: false, invalid };
}
