/* Morning Brief — site configuration (no secrets here; everything is public). */
window.MORNING_BRIEF_CONFIG = {
  // PRIMARY data source: the public GitHub repo. New briefs and deep dives pushed to `main`
  // (tools/sync.sh) show up on the published site without republishing it.
  dataBaseUrl: 'https://raw.githubusercontent.com/boydt/morning-brief/main/data/',

  // Used to (1) pin raw reads to the latest commit on `main`, because raw.githubusercontent.com
  // caches ~5 min even with a ?t= query, and (2) as a secondary source (contents API).
  // Unauthenticated GitHub API limit: 60 requests/hour per IP. Set githubRepo to null to disable API use.
  githubRepo: 'boydt/morning-brief',
  githubBranch: 'main',

  // Bundled copy shipped with the site (relative path) — used if GitHub can't be reached.
  localDataPath: 'data/',

  aprilChatUrl: 'grokbot://app/v1/agent?id=30d1a93b-3a8a-435f-8b71-efa1bd39e86a',
};
