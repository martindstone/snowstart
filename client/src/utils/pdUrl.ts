/** The PagerDuty subdomain isn't exposed by every endpoint, but every PD object's html_url carries it. */
export function derivePdInstanceUrl(htmlUrl: string | undefined): string {
  if (!htmlUrl) return "";
  try {
    const url = new URL(htmlUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}
