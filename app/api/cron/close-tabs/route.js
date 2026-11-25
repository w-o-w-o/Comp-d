import { closeDueTabs } from "../../../../lib/tabs";

// GET /api/cron/close-tabs
// Run once a day by Vercel Cron (see vercel.json): charges every re-analysis
// tab that's been open 24 hours, and releases holds nothing was used from.
// Tabs are also closed whenever their user comes back, so this catches the
// ones whose users don't. Vercel sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const closed = await closeDueTabs();
    return Response.json({ closed });
  } catch (err) {
    console.error("Closing tabs failed:", err);
    return Response.json({ error: "Failed." }, { status: 500 });
  }
}
