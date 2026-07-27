/**
 * Links out to Planning Center's own web app.
 *
 * Tally reads people from Planning Center and writes almost nothing back, so
 * "go and fix it there" is a real answer several screens have to give. It was
 * given by three of them with three private copies of the same URL builder,
 * which is a template string nobody would notice drifting until a link quietly
 * stopped resolving.
 */

/**
 * The person's page in Planning Center People.
 *
 * The `AC` prefix is Planning Center's own: the web app addresses people by a
 * prefixed id, while the API returns the bare number. Everything Tally holds is
 * the API's form, so the prefix is added here rather than stored.
 */
export function pcoPersonUrl(pcoPersonId: string): string {
  return `https://people.planningcenteronline.com/people/AC${pcoPersonId}`;
}
