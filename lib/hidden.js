import { ensureTables, sql } from "./db";

// Homes a user marked "not for me". They're left out of that user's later AI
// analyses (for renting or buying, whichever they were looking at), and the
// reasons they gave are passed to the AI as preferences.

export const MAX_REASON = 160;
// How many recent reasons the AI sees (they're short, but add to every request).
const MAX_REASONS_FOR_AI = 10;

const cleanReason = (r) => String(r || "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);

export async function hideListing(userId, { listingId, mode, address, reason }) {
  await ensureTables();
  await sql`
    INSERT INTO hidden_listings (user_id, listing_id, mode, address, reason)
    VALUES (${userId}, ${listingId}, ${mode}, ${address}, ${cleanReason(reason)})
    ON CONFLICT (user_id, listing_id, mode) DO UPDATE SET
      reason = EXCLUDED.reason, address = EXCLUDED.address, created_at = now()`;
}

export async function unhideListing(userId, listingId, mode) {
  await ensureTables();
  await sql`DELETE FROM hidden_listings WHERE user_id = ${userId} AND listing_id = ${listingId} AND mode = ${mode}`;
}

// The user's hidden homes for renting or buying, newest first:
// [{ listingId, address, reason, createdAt }].
export async function hiddenListings(userId, mode) {
  if (!sql) return [];
  await ensureTables();
  const rows = await sql`
    SELECT listing_id, address, reason, created_at FROM hidden_listings
    WHERE user_id = ${userId} AND mode = ${mode}
    ORDER BY created_at DESC`;
  return rows.map((r) => ({ listingId: r.listing_id, address: r.address, reason: r.reason, createdAt: r.created_at }));
}

// The reasons to give the AI (most recent first, without addresses).
export const reasonsForAi = (hidden) =>
  hidden
    .map((h) => h.reason)
    .filter(Boolean)
    .slice(0, MAX_REASONS_FOR_AI);
