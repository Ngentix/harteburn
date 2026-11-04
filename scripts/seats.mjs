// Team seats on the license (hb-seats-1 piece 4).
//
// A Team license names one person and the seats the service signed for them. The plugin holds
// no private key: it only checks a signature. Cloud, and a license that is not Team, is unchanged.
//
// The person types one line, alone: "go piece <n>:". The hook copies the verified seats into the
// ledger row. A later check trusts the signature, not the row's other fields. A builder's go does
// not stand in for the product owner or the architecture owner; it is shown as their own sign-off.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const SEAT_PAGE = "docs/roles.md#team-seats";

/** The service's seat-signing public key (SPKI DER, base64), pinned here: an environment variable a
 * project's settings can set would let anyone sign their own seats (F2, Security on 4edfbd9..0558cd5).
 * Empty until the production key is minted: then no seat verifies, as the service signs none. */
export const SEAT_PUBLIC_KEY = "";

export function seatRefusal(text) {
  return `${text} (${SEAT_PAGE})`;
}

export const ROLES = Object.freeze({
  "product-owner": "the product owner",
  "architecture-owner": "the architecture owner",
  "security-owner": "the security owner",
  "builder": "its builder",
});

const NAMED = Object.freeze({
  doneLines: "a Done-line change",
  scope: "a scope change",
  architecture: "an architecture-doc change",
  accept: "a risk accept",
});

/** The bytes the service signs. Extra fields on the seat never enter them. */
export function canonical(orgId, seat) {
  return `${orgId}\n${seat.person}\n${seat.role}\n${seat.exp}`;
}

function keyOf(key, kind) {
  if (!key) return null;
  if (typeof key !== "string") return key;
  if (kind === "public" && !key.includes("BEGIN")) return createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  return kind === "private" ? createPrivateKey(key) : createPublicKey(key);
}

/** A seat entry the license file can store. `exp` is an ISO time. */
export function signSeat(privateKey, orgId, seat) {
  const body = { person: String(seat.person), role: String(seat.role), exp: String(seat.exp) };
  const sig = sign(null, Buffer.from(canonical(orgId, body)), keyOf(privateKey, "private")).toString("base64url");
  return { ...body, sig };
}

/** True when this seat was signed for `orgId`, names a known role, and has not expired. */
export function seatVerifies(publicKey, orgId, seat, now = Date.now()) {
  if (!seat || typeof seat.person !== "string" || typeof seat.role !== "string" || typeof seat.exp !== "string" || typeof seat.sig !== "string") return false;
  if (!ROLES[seat.role] || !orgId) return false;
  const exp = Date.parse(seat.exp);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const pub = keyOf(publicKey, "public");
  if (!pub) return false;
  try {
    return verify(null, Buffer.from(canonical(orgId, seat)), pub, Buffer.from(seat.sig, "base64url"));
  } catch {
    return false;
  }
}

/** The signed seats on this license that still verify, for its org and no other. */
export function verifiedSeats(license, publicKey, now = Date.now()) {
  const orgId = license?.org_id;
  return (Array.isArray(license?.seats) ? license.seats : []).filter((s) => seatVerifies(publicKey, orgId, s, now));
}

/** The seats this license's person still holds. Another person's seat on the same file does not count. */
export function actorSeats(license, publicKey, now = Date.now()) {
  const person = license?.person;
  if (!person) return [];
  return verifiedSeats(license, publicKey, now).filter((s) => s.person === person);
}

/** The one seat this license's person still holds, or null. */
export function actorSeat(license, publicKey, now = Date.now()) {
  return actorSeats(license, publicKey, now)[0] || null;
}

/** What a piece started with. The board stamps this once, then a later edit is a change. */
export function seatSnapshot(rec, arch = "") {
  return {
    done: JSON.stringify(rec?.done_when ?? []),
    scope: JSON.stringify(rec?.scope ?? []),
    ...(arch ? { arch } : {}),
  };
}

/**
 * "go piece <n>:" as the whole message, or null. A second line never counts: a pasted note can carry one.
 */
export function goLine(prompt) {
  const text = String(prompt || "").trim();
  if (/[\n\r\u2028\u2029\u0085]/.test(text)) return null;
  const m = /^go\s+piece\s+(\d+)\s*:\s*$/i.exec(text);
  return m ? { piece: Number(m[1]) } : null;
}

/**
 * What the board says before it stamps a piece on a Team license.
 * `go` / `accept` are transcript-backed rows whose copied seats re-verify.
 * Returns `{ problems, shown }`. `shown` is "signed off by its builder" when a builder's go verifies.
 */
export function seatVerdict({ tier, license, publicKey, now, piece, changes = {}, go = null, accept = null }) {
  if (tier !== "team" && license?.tier !== "team") return { problems: [], shown: "" };
  const orgId = license?.org_id || "";
  const goSeats = verifiedSeats({ org_id: orgId, seats: go?.seats }, publicKey, now);
  const acceptSeats = verifiedSeats({ org_id: orgId, seats: accept?.seats }, publicKey, now);
  const goRole = (role) => goSeats.some((s) => s.role === role);
  const problems = [];
  const need = [];
  if (changes.doneLines || changes.scope) need.push(["product-owner", changes.doneLines ? "doneLines" : "scope"]);
  if (changes.architecture) need.push(["architecture-owner", "architecture"]);
  for (const [role, why] of need) {
    if (!goRole(role)) problems.push(seatRefusal(`Piece ${piece}: ${NAMED[why]} needs ${ROLES[role]} to type "go piece ${piece}:"`));
  }
  if (changes.accept && !acceptSeats.some((s) => s.role === "security-owner")) {
    problems.push(seatRefusal(`Piece ${piece}: ${NAMED.accept} needs ${ROLES["security-owner"]}`));
  }
  const shown = goRole("builder") ? "signed off by its builder" : "";
  return { problems, shown };
}
