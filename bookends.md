BOOKENDS MODE overrides BUILD+PROVE and ROLES inside a piece; owner decisions, the full gate and Done in production stand.
- PIECE START, one beat: Architect designs if a load-bearing path is touched; Prover writes failing tests; Designer: the full pass on a visible piece; Security: abuse cases on a security-domain piece.
- DURING THE BUILD, no roles: fix in-scope finds, one board line each ("Found: … fixed <sha>"); batch live loops (fix every failure a run shows, rebuild once, rerun only failed checks); a fix is proven by a TARGETED run (only the flows and checks it touches); the full suite runs once, at the piece end or before the gate; no convened/excused line.
- A BLOCKING DESIGN FIND convenes the Architect only for a shared contract or a load-bearing path; else pick it, the end review judges.
- PIECE END, one beat: one round, Prover + Architect (+ Designer if visible, Security if security-domain) on the piece's whole diff (`--base <piece start>`), logged finds included; Product triages the finds in one pass.
- MEASURE each leg: scripts/leg.mjs (go → deployed, usage %, interventions, escapes).
