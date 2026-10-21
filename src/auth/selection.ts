/**
 * Rules for which account a sign-in leaves selected.
 *
 * The account a workspace is bound to is chosen by the repository, so signing
 * in for that workspace must not change the account the user selected for
 * usage and management. A sign-in the user asked for by name does select it.
 */

export type SignInSelection = "select" | "keep";

/**
 * Whether a sign-in for `profile` should become the active account.
 *
 * @param bound whether the current workspace is bound to an account
 * @param explicit whether the user named this account in the action that
 *   triggered the sign-in, rather than the workspace selecting it
 */
export function signInSelection(bound: boolean, explicit: boolean): SignInSelection {
  if (explicit) return "select";
  return bound ? "keep" : "select";
}
