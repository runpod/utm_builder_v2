/** Run migrations as an explicit deploy step (not at app boot). */
process.env.RUN_MIGRATIONS_ON_BOOT = "true";
import { getDb } from "./client";

getDb()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
