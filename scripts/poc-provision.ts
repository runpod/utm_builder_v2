/**
 * One-off POC provisioning: parse DATABASE_URL from a pulled Vercel env file,
 * run migrations + seed, and ensure an admin user exists. Prints only
 * non-sensitive counts. Not part of the app runtime.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

// Accept the connection string from DATABASE_URL directly, or from a pulled
// env file passed as the first arg (usage: <env-file|-> <admin-email>).
const envArg = process.argv[2];
const adminEmail = (process.argv[3] ?? "").trim().toLowerCase();
let url = process.env.DATABASE_URL ?? "";
if (!url && envArg && envArg !== "-") {
  const text = readFileSync(envArg, "utf8");
  const match = text.match(/^DATABASE_URL=(.*)$/m);
  if (match) url = match[1].trim().replace(/^["']|["']$/g, "");
}
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("Provide a valid DATABASE_URL (env var) and admin email.");
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.RUN_MIGRATIONS_ON_BOOT = "true"; // this script IS the migration step
const finalAdmin = adminEmail && adminEmail.includes("@") ? adminEmail : "kenneth.lim@runpod.io";
if (finalAdmin !== adminEmail) console.log(`admin email -> ${finalAdmin}`);

const scheme = url.split("://")[0];
const host = url.replace(/^[^@]*@/, "").split("/")[0];
console.log(`DATABASE_URL scheme=${scheme} host=${host.replace(/:.*/, "")}`);

async function main() {
  const { getDb } = await import("@/db/client");
  const { ensureSeed } = await import("@/db/seed");
  const { users, campaigns, links } = await import("@/db/schema");
  const { newId } = await import("@/core/ids");

  const db = await getDb(); // runs migrations
  await ensureSeed(db);

  const [existing] = await db.select().from(users).where(eq(users.email, finalAdmin)).limit(1);
  if (existing) {
    if (existing.role !== "admin" || !existing.active) {
      await db.update(users).set({ role: "admin", active: true }).where(eq(users.id, existing.id));
      console.log(`promoted existing user to admin: ${finalAdmin}`);
    } else {
      console.log(`admin already present: ${finalAdmin}`);
    }
  } else {
    await db.insert(users).values({
      id: newId("user"),
      email: finalAdmin,
      name: finalAdmin.split("@")[0].replace(/[._-]+/g, " "),
      role: "admin",
      active: true,
    });
    console.log(`created admin user: ${finalAdmin}`);
  }

  const userCount = (await db.select().from(users)).length;
  const campaignCount = (await db.select().from(campaigns)).length;
  const linkCount = (await db.select().from(links)).length;
  console.log(`counts -> users:${userCount} campaigns:${campaignCount} links:${linkCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
