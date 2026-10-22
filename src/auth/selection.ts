/**
 * Rules for which account a sign-in leaves selected.
 *
 * The account a workspace is bound to is chosen by the repository, so signing
 * in for that workspace must not change the account the user selected for
 * usage and management. A sign-in the user asked for by name does select it.
 *
 * The decision is made from the origin captured when the sign-in was
 * requested. It must not be re-derived from the current workspace state,
 * because the binding can change while the authorization is in progress, and
 * a named-entry mapping is a binding that the default-entry check does not
 * see.
 */

export type SignInSelection = "select" | "keep";

/**
 * Whether a sign-in should become the active account.
 *
 * @param explicit whether the user named this account in the action that
 *   triggered the sign-in, rather than the workspace or a mapping selecting
 *   it
 */
export function signInSelection(explicit: boolean): SignInSelection {
  return explicit ? "select" : "keep";
}
