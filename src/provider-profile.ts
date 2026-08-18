import { DEFAULT_XAI_PROFILE, normalizeProfileId } from "./auth/oauth";

export function profileFromConfiguration(configuration: Readonly<Record<string, unknown>> | undefined): string {
  try {
    return normalizeProfileId(typeof configuration?.profile === "string" ? configuration.profile : DEFAULT_XAI_PROFILE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid xAI Grok profile. Update this provider entry in Manage Language Models. ${message}`);
  }
}

export function profileQualifiedModelId(profile: string, modelId: string): string {
  return `${normalizeProfileId(profile)}::${modelId}`;
}
