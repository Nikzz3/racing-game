import { describe, expect, it } from "vitest";
import { testDatabaseUrl, withTestSchema } from "./test-database";

// The daily count adds up in SQL (`ON CONFLICT ... DO UPDATE`), so only a real
// Postgres can prove a restart picks up where the last process left off.
describe.skipIf(!testDatabaseUrl)("Jev usage", () => {
  it("adds decisions per UTC day and reads them back after a restart", async () => {
    await withTestSchema(async ({ initDb }) => {
      await initDb();
      const { postgresJevUsage } = await import("./jev-usage");
      expect(await postgresJevUsage.decisionsOn("2026-09-25")).toBe(0);

      await postgresJevUsage.add("2026-09-25", 3);
      await postgresJevUsage.add("2026-09-25", 4);
      await postgresJevUsage.add("2026-09-26", 1);
      // initDb runs on every boot; it must keep the count.
      await initDb();

      expect(await postgresJevUsage.decisionsOn("2026-09-25")).toBe(7);
      expect(await postgresJevUsage.decisionsOn("2026-09-26")).toBe(1);
    });
  }, 15_000);
});
