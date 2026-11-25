// Where to go after logging in or signing up: the main page, unless the person
// was on their way to a search (the Search page, a search's results, or the
// free demo), so "Start searching" and "Try it free" carry on where they left.
// Only a path on this site is ever used (a full URL is cut down to its path).
export function afterAuthUrl(redirectUrl) {
  let path = "/";
  try {
    const url = new URL(typeof redirectUrl === "string" ? redirectUrl : "/", "http://local");
    path = url.pathname + url.search;
  } catch {}
  return /^\/(search|results)(\/|\?|$)/.test(path) ? path : "/";
}
