import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Deletes mission-evidence objects older than 7 days. Uses server-side secrets only.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("Authorization") || "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`;
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || auth !== expected) return new Response("Unauthorized", { status: 401 });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response("Missing server configuration", { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const bucket = "mission-evidence";
  let removed = 0;
  const expiredPaths: string[] = [];

  async function walk(prefix = "") {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
      if (error) throw error;
      if (!data?.length) break;
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          const created = item.created_at ? new Date(item.created_at).getTime() : NaN;
          if (Number.isFinite(created) && created < cutoff) expiredPaths.push(path);
        } else {
          await walk(path);
        }
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }

  try {
    await walk();
    for (let i = 0; i < expiredPaths.length; i += 100) {
      const batch = expiredPaths.slice(i, i + 100);
      const { error: removeError } = await supabase.storage.from(bucket).remove(batch);
      if (removeError) throw removeError;
      removed += batch.length;
    }
    return Response.json({ ok: true, bucket, retention_days: 7, deleted_objects: removed });
  } catch (error) {
    console.error("mission evidence cleanup failed", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
});
