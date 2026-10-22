import * as vscode from "vscode";
import { DEFAULT_XAI_PROFILE, normalizeProfileId } from "./auth/oauth";
import {
  classifyProfileMap,
  resolveProfileBinding,
  type ProfileBindingSource,
  type ProfileResolution,
  type ProfileScopeValues,
} from "./workspace-profile";

export { resolveProfileBinding };
export type { ProfileBindingSource, ProfileResolution, ProfileScopeValues };

/** The setting that binds an xAI profile to a workspace, folder, or the user. */
export const PROFILE_SETTING = "profile";

/** The setting that maps Manage Language Models entries to xAI profiles. */
export const PROFILE_MAP_SETTING = "profileMap";

/** The setting that turns workspace account binding on or off. */
export const BINDING_SETTING = "workspaceBinding";

export type WorkspaceBindingMode = "off" | "on" | "trusted";

/**
 * Reads the configured binding mode. `off` disables workspace binding, `on`
 * enables it even in an untrusted workspace, and `trusted` (the default) only
 * honours bindings from workspaces the user trusts.
 *
 * The mode is only read from the user scope. A repository must not be able to
 * relax the trust gate for itself, so a workspace or folder value for this
 * setting is ignored.
 */
export function bindingModeFromConfiguration(configuration: vscode.WorkspaceConfiguration): WorkspaceBindingMode {
  const inspected = configuration.inspect<string>(BINDING_SETTING);
  const value = inspected?.globalValue;
  return value === "off" || value === "on" || value === "trusted" ? value : "trusted";
}

/**
 * The configuration scope used for resource scoped reads.
 *
 * A folder resource resolves the folder's own settings. Without a folder the
 * workspace scope is used, and `null` asks for the value that applies to any
 * resource, which keeps VS Code from warning about a missing resource.
 */
function configurationScope(): vscode.ConfigurationScope | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri : null;
}

/**
 * Reads the profile binding values for every workspace folder, plus the
 * user-scoped values.
 *
 * Folder and workspace values are read with `inspect` so a folder's own
 * `.vscode/settings.json` can be told apart from a `.code-workspace` value.
 * The user values are only read from the global scope so a workspace cannot
 * silently redefine the user's default account.
 */
export function readProfileScopes(): ProfileScopeValues[] {
  const userInspected = vscode.workspace.getConfiguration("grokCopilot", configurationScope()).inspect<string>(PROFILE_SETTING);
  const userMapInspected = vscode.workspace.getConfiguration("grokCopilot", configurationScope()).inspect<Record<string, string>>(PROFILE_MAP_SETTING);
  const user = userInspected?.globalValue;
  const userMap = userMapInspected?.globalValue;

  const scopes: ProfileScopeValues[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const inspected = vscode.workspace.getConfiguration("grokCopilot", folder.uri).inspect<string>(PROFILE_SETTING);
    const mapInspected = vscode.workspace.getConfiguration("grokCopilot", folder.uri).inspect<Record<string, string>>(PROFILE_MAP_SETTING);
    scopes.push({
      folder: inspected?.workspaceFolderValue,
      workspace: inspected?.workspaceValue,
      folderMap: mapInspected?.workspaceFolderValue,
      workspaceMap: mapInspected?.workspaceValue,
    });
  }
  if (!scopes.length) return [{ user, userMap }];
  return scopes.map((scope) => ({ ...scope, user, userMap }));
}

/**
 * Whether workspace-provided bindings may be honoured right now.
 *
 * An untrusted workspace is controlled by whoever opened it, so a binding
 * from it must not be able to move requests to a different account. The user
 * scope is always honoured because the user controls it.
 */
export function bindingAllowed(mode: WorkspaceBindingMode): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  return vscode.workspace.isTrusted;
}

export interface WorkspaceProfileResolution {
  /** The profile the given Manage Language Models entry resolves to. */
  readonly entry: ProfileResolution;
  /**
   * The profile the workspace is bound to, resolved from the default entry.
   *
   * The workspace binding is a property of the workspace rather than of a
   * single entry, so it is derived from the default entry. Deriving it from
   * the entry that happens to be resolving would let one entry's binding
   * overwrite another's.
   */
  readonly workspace: ProfileResolution;
  /** Bindings whose configured value was not a valid profile ID. */
  readonly invalid: readonly ProfileBindingSource[];
}

/**
 * Resolves the xAI profiles for the current workspace.
 *
 * The entry's own profile is the baseline. A per-entry mapping or a
 * workspace binding overrides it so a repository can pin its account, and a
 * user binding acts as the default account for entries that do not name one.
 *
 * Invalid values are reported once per resolution. Callers that poll this
 * function should use {@link resolveWorkspaceProfilesQuietly} so the warning
 * is not repeated on every call.
 */
export function resolveWorkspaceProfiles(entryProfile: string): WorkspaceProfileResolution {
  const resolved = resolveWorkspaceProfilesQuietly(entryProfile);
  if (resolved.invalid.length) {
    const sources = resolved.invalid.map((source) => `grokCopilot.${PROFILE_SETTING} (${source})`).join(", ");
    void vscode.window.showWarningMessage(
      `Ignoring an invalid xAI Grok profile binding in ${sources}. Profile IDs use letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return { entry: resolved.entry, workspace: resolved.workspace, invalid: resolved.invalid };
}

/**
 * Resolves the xAI profiles for the current workspace without reporting
 * invalid values. Used by callers that resolve on every read.
 */
export function resolveWorkspaceProfilesQuietly(entryProfile: string): WorkspaceProfileResolution {
  const configuration = vscode.workspace.getConfiguration("grokCopilot", configurationScope());
  const mode = bindingModeFromConfiguration(configuration);
  const scopes = readProfileScopes();
  const trusted = bindingAllowed(mode);
  const entry = resolveProfileBinding(entryProfile, scopes, { trusted });
  const workspace = resolveProfileBinding(DEFAULT_XAI_PROFILE, scopes, { trusted });
  const invalid = [...new Set([...entry.invalid, ...workspace.invalid])];
  return {
    entry: { ...entry, invalid },
    workspace: { ...workspace, invalid },
    invalid,
  };
}
