/** A present but empty invitation is an invalid exchange, not permission to reuse an older session. */
export function readStudyInvitationFragment() {
  const url = new URL(window.location.href);
  const token = new URLSearchParams(url.hash.slice(1)).get('invite');
  if (url.hash) { url.hash = ''; window.history.replaceState({}, '', url); }
  return token;
}
