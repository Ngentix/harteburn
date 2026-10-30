// HarteBurn template: every local link on every signed-in page opens. A dashboard button can point
// at a route its session cookie cannot reach (401 in a browser) when the builder looks at the page
// and never clicks it. Copy this file into the project's test helpers and call it from one test
// over the pages each party signs in to.
//
//   const { failures, checked } = await crawlLinks({
//     pages: ["/owner/earnings", "/buyer"],            // the signed-in pages to start from
//     get: async (url, cookie) => ({ status, body }),  // the project's own request helper
//     cookieFor: (url) => url.startsWith("/buyer") ? buyerCookie : ownerCookie,
//   });
//   assert.deepEqual(failures, []);
//
// Follows only local links (href="/…"), one level deep from the pages given, each once. A status in
// `bad` (default 401, 403, 404, 500+) is a failure; a redirect is not (sign-in redirects are a page's own business).

/** The local hrefs in a page's HTML, entities decoded, fragments dropped. */
export function localHrefs(html) {
  return [...String(html).matchAll(/href="(\/[^"#]*)/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

export async function crawlLinks({ pages, get, cookieFor = () => undefined, bad = (s) => s === 401 || s === 403 || s === 404 || s >= 500 }) {
  const isBad = typeof bad === "function" ? bad : (s) => bad.includes(s);
  const failures = [], checked = [], seen = new Set();
  for (const page of pages) {
    const from = await get(page, cookieFor(page));
    if (isBad(from.status)) { failures.push({ from: "(start)", href: page, status: from.status }); continue; }
    for (const href of localHrefs(from.body)) {
      if (seen.has(href)) continue;
      seen.add(href);
      const r = await get(href, cookieFor(href));
      checked.push(href);
      if (isBad(r.status)) failures.push({ from: page, href, status: r.status });
    }
  }
  return { failures, checked };
}
