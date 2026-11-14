// features/rooms.md — two players create and join a Room on the real build and see each other.
import { journey } from "../scripts/harness.mjs";
import {
  createRoom,
  joinRoom,
  openLobby,
  openSetupTab,
  selectCar,
  standings,
  uid,
} from "./lib.mjs";

const id = uid();
const ROOM = `Verify Room ${id}`;
const A = `Alpha ${id}`;
const B = `Bravo ${id}`;

await journey("rooms", async (j) => {
  const a = await j.player("a");
  const b = await j.player("b");
  // Pass A's socket through untouched, but keep a handle so the journey can drop it later.
  const aSockets = [];
  await a.routeWebSocket(
    (url) => url.port === new URL(j.env.server).port,
    (socket) => {
      socket.connectToServer();
      aSockets.push(socket);
    },
  );
  const T = { timeout: 30_000 }; // loaded machines + software WebGL
  const roomRow = (page) => page.locator(".room-row").filter({ hasText: ROOM });

  await j.step("both players load the Lobby", async () => {
    await Promise.all([openLobby(a), openLobby(b)]);
    await j.shot("a", "01-lobby-garage");
  });

  await j.step("A picks the SUV in the Garage", () => selectCar(a, "suv"));

  await j.step("A creates the Room and lands in it", async () => {
    await createRoom(a, { playerName: A, roomName: ROOM });
    await j.expect(standings(a)).toContainText(A);
    await j.shot("a", "02-a-in-room");
  });

  await j.step("B sees the Room listed with 1 racing", async () => {
    await b.reload();
    await b.locator(".lobby-deck").waitFor();
    await openSetupTab(b, "race");
    const row = b.locator(".room-row").filter({ hasText: ROOM });
    await j.expect(row).toContainText("1 racing");
    await j.aria("b", "03-b-room-list", ".lobby-deck");
  });

  await j.step("B joins and both HUD standings list both drivers", async () => {
    await joinRoom(b, { playerName: B, roomName: ROOM });
    for (const page of [a, b]) {
      await j.expect(standings(page)).toContainText(A);
      await j.expect(standings(page)).toContainText(B);
    }
    await j.shot("a", "04-a-sees-b");
    await j.shot("b", "05-b-sees-a");
  });

  await j.step("server announced the Room to both (joined messages)", () => {
    const joined = [...j.received("a", "joined"), ...j.received("b", "joined")];
    j.json("joined-messages", joined);
    j.expect(joined.length).toBeGreaterThanOrEqual(2);
  });

  await j.step("the Room row is persisted", async () => {
    const rows = await j.sql(
      "SELECT id, name, track, difficulty, created_at FROM rooms WHERE name = $1",
      [ROOM],
    );
    j.json("db-rooms", rows);
    j.expect(rows).toHaveLength(1);
  });

  await j.step(
    "B leaves: back in the Lobby, A's standings drop B, the Room list shows 1 racing",
    async () => {
      await b.getByRole("button", { name: "Leave race" }).click();
      await b.locator(".lobby-deck").waitFor();
      await j.expect(b.locator(".hud-standings")).toHaveCount(0);
      await j.expect(standings(a)).not.toContainText(B, T);
      await j.expect(standings(a)).toContainText(A, T);
      await j.shot("b", "06-b-back-in-lobby");
      await j.shot("a", "07-a-alone-again");
      await openSetupTab(b, "race");
      await j.expect(roomRow(b)).toContainText("1 racing", T);
      await j.aria("b", "08-b-room-list-after-leave", ".lobby-deck");
      j.expect(j.received("b", "left").length).toBeGreaterThanOrEqual(1);
    },
  );

  await j.step("B rejoins so A has someone watching", async () => {
    await joinRoom(b, { playerName: B, roomName: ROOM });
    await j.expect(standings(b)).toContainText(A, T);
    await j.expect(standings(a)).toContainText(B, T);
  });

  await j.step(
    "A's connection drops: A is back in the Lobby and B's standings drop A",
    async () => {
      const before = aSockets.length;
      await aSockets.at(-1).close();
      await j.expect(a.locator(".lobby-deck")).toBeVisible({ timeout: 15_000 });
      await j.expect(standings(b)).not.toContainText(A, { timeout: 15_000 });
      await j.shot("a", "09-a-after-drop");
      await j.shot("b", "10-b-sees-a-gone");
      // The client reconnects on its own with a fresh socket.
      await j.expect.poll(() => aSockets.length, { timeout: 15_000 }).toBeGreaterThan(before);
      await j
        .expect(a.locator(".connection-status"))
        .toHaveText("LIVE MULTIPLAYER", { timeout: 15_000 });
      await j.expect(a.locator(".connect-error")).toHaveCount(0);
    },
  );

  await j.step("A, reconnected, sees the Room still open and rejoins it", async () => {
    await openSetupTab(a, "race");
    await j.expect(roomRow(a)).toContainText("1 racing", T);
    await j.aria("a", "11-a-room-list-after-reconnect", ".lobby-deck");
    await joinRoom(a, { playerName: A, roomName: ROOM });
    for (const page of [a, b]) {
      await j.expect(standings(page)).toContainText(A, T);
      await j.expect(standings(page)).toContainText(B, T);
    }
    await j.shot("a", "12-a-back-in-room");
    await j.shot("b", "13-b-sees-a-back");
    j.expect(j.received("a", "joined").length).toBeGreaterThanOrEqual(2);
  });

  await j.step("the Room row survived leave and drop", async () => {
    const rows = await j.sql("SELECT name FROM rooms WHERE name = $1", [ROOM]);
    j.expect(rows).toHaveLength(1);
  });
});
