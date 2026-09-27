import {
  applySubscription,
  check,
  db,
  env,
  json,
  paddle,
} from "../_shared/runtime.ts";
Deno.serve(async (request) => {
  const secret = env("BILLING_RECONCILIATION_SECRET");
  if (
    request.method !== "POST" ||
    !secret ||
    request.headers.get("Authorization") !== `Bearer ${secret}`
  )
    return json({ error: "Unauthorized" }, 401);
  try {
    const records: { subscription_id: string }[] = [];
    for (let offset = 0; ; offset += 100) {
      const page =
        check(
          await db()
            .from("subscriptions")
            .select("subscription_id")
            .order("subscription_id")
            .range(offset, offset + 99),
        ) || [];
      records.push(...page);
      if (page.length < 100) break;
    }
    for (const row of records) {
      const data = await paddle(`/subscriptions/${row.subscription_id}`);
      await applySubscription(
        `reconcile:${data.id}:${data.updated_at}`,
        data.updated_at,
        data,
      );
    }
    return json({ checked: records.length });
  } catch {
    return json({ error: "Reconciliation failed; retry required" }, 500);
  }
});
