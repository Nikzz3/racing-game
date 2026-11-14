// features/garage-and-circuits.md — Garage and Circuit carousels, locks, progress steps, and the chosen Track reaching the Room.
import { journey } from "../scripts/harness.mjs";
import { openLobby, standings, uid } from "./lib.mjs";

const id = uid();
const ROOM = `Circuit Room ${id}`;
const DRIVER = `Garage ${id}`;
// Variants that need a Medal tier (shared/src/medals.ts VARIANT_UNLOCKS); a fresh player has none.
const LOCKED = ["sedan-sports", "race", "police", "race-future"];

await journey("garage-and-circuits", async (j) => {
  const a = await j.player("a");
  const deck = a.locator(".lobby-deck");
  const activeCar = a.locator(".garage-card.active");
  const activeTrack = a.locator(".track-card.active");
  const selectCar = a.getByRole("button", { name: "Select car", exact: true });
  const selectTrack = a.getByRole("button", {
    name: "Select track",
    exact: true,
  });
  const variantNow = () => activeCar.getAttribute("data-variant");

  await j.step("Garage opens on the first free car", async () => {
    await openLobby(a);
    await j.expect(deck).toHaveAttribute("data-screen", "garage");
    await j.expect(selectCar).toBeVisible();
    await j.expect(a.getByRole("button", { name: "Create & Race" })).toHaveCount(0);
    await j.shot("a", "01-garage");
  });

  let start;
  await j.step("arrow buttons move the carousel forward and back", async () => {
    start = await variantNow();
    await a.getByRole("button", { name: "Next car", exact: true }).click();
    await j.expect(activeCar).not.toHaveAttribute("data-variant", start);
    await j.shot("a", "02-next-car");
    await a.getByRole("button", { name: "Previous car", exact: true }).click();
    await j.expect(activeCar).toHaveAttribute("data-variant", start);
  });

  await j.step("left/right arrow keys move the carousel", async () => {
    await a.getByRole("button", { name: "Next car", exact: true }).focus();
    await a.keyboard.press("ArrowRight");
    await j.expect(activeCar).not.toHaveAttribute("data-variant", start);
    await j.shot("a", "03-arrow-right");
    await a.keyboard.press("ArrowLeft");
    await j.expect(activeCar).toHaveAttribute("data-variant", start);
  });

  await j.step("cycling Next car visits every car and wraps", async () => {
    const count = await a.locator(".garage-card[data-variant]").count();
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      seen.add(await variantNow());
      await a.getByRole("button", { name: "Next car", exact: true }).click();
      await j.expect(activeCar).not.toHaveAttribute("data-variant", [...seen].at(-1));
    }
    j.expect(seen.size).toBe(count);
    await j.expect(activeCar).toHaveAttribute("data-variant", start);
  });

  await j.step("Medal-gated cars are locked and cannot be selected", async () => {
    for (const variant of LOCKED) {
      const card = a.locator(`.garage-card[data-variant="${variant}"]`);
      await j.expect(card).toHaveClass(/locked/);
      await card.click();
      await j.expect(card).toHaveAttribute("aria-checked", "true");
      await j.expect(selectCar).toBeDisabled();
      await j.expect(a.locator(".car-lock-note")).toBeVisible();
      await j.expect(a.locator(".car-lock-note")).toContainText(/medal/i);
      if (variant === "police") await j.shot("a", "04-locked-police");
    }
    await selectCar.click({ force: true });
    await j.expect(deck).toHaveAttribute("data-screen", "garage");
    await j.aria("a", "04-locked-garage", ".garage-screen");
  });

  await j.step("clicking a free car card selects it and unlocks Select car", async () => {
    await selectCarCard("suv");
    await j.expect(selectCar).toBeEnabled();
    await j.expect(a.locator(".car-lock-note")).toBeHidden();
    await j.shot("a", "05-suv-selected");
  });

  await j.step("the selected car survives a reload", async () => {
    await a.reload();
    await deck.waitFor();
    await j
      .expect(a.locator('.garage-card[data-variant="suv"]'))
      .toHaveAttribute("aria-checked", "true");
    await j.shot("a", "06-suv-after-reload");
  });

  const tracks = [];
  await j.step("Select car opens the Circuit carousel with all three Tracks", async () => {
    await selectCar.click();
    await j.expect(deck).toHaveAttribute("data-screen", "track");
    await j.expect(selectTrack).toBeVisible();
    await j.expect(a.getByRole("button", { name: "Create & Race" })).toHaveCount(0);
    const cards = a.locator(".track-card[data-track]");
    await j.expect(cards).toHaveCount(3);
    for (const card of await cards.all())
      tracks.push({
        id: await card.getAttribute("data-track"),
        name: (await card.locator(".track-card-name").innerText()).trim(),
      });
    j.json("tracks", tracks);
    j.expect(new Set(tracks.map((t) => t.id)).size).toBe(3);
    await j.shot("a", "07-circuit");
  });

  await j.step("arrow buttons and arrow keys move the Circuit carousel", async () => {
    const first = await activeTrack.getAttribute("data-track");
    await a.locator('[data-track-carousel="next"]').click();
    await j.expect(activeTrack).not.toHaveAttribute("data-track", first);
    await a.locator('[data-track-carousel="previous"]').click();
    await j.expect(activeTrack).toHaveAttribute("data-track", first);
    await a.locator('[data-track-carousel="next"]').focus();
    await a.keyboard.press("ArrowRight");
    await j.expect(activeTrack).not.toHaveAttribute("data-track", first);
    await a.keyboard.press("ArrowLeft");
    await j.expect(activeTrack).toHaveAttribute("data-track", first);
  });

  const chosen = () => tracks.at(-1);
  await j.step("every Track card can be clicked and becomes the active Circuit", async () => {
    for (const t of tracks) {
      await a.locator(`.track-card[data-track="${t.id}"]`).click();
      await j.expect(activeTrack).toHaveAttribute("data-track", t.id);
      await j.expect(a.locator(".hero-track-name")).toContainText(t.name);
      await j.shot("a", `08-track-${t.id}`);
    }
  });

  await j.step("Select track opens Race Setup showing the car and Circuit", async () => {
    await selectTrack.click();
    await j.expect(deck).toHaveAttribute("data-screen", "settings");
    await j.expect(a.locator(".selected-track-name")).toContainText(chosen().name);
    await j.expect(a.locator(".selected-car-name")).toBeVisible();
    await j.shot("a", "09-race-setup");
  });

  await j.step("progress steps go back to Circuit and Garage and keep the choices", async () => {
    const nav = a.getByRole("navigation", { name: "Race setup progress" });
    await nav.getByRole("button", { name: /CIRCUIT/ }).click();
    await j.expect(deck).toHaveAttribute("data-screen", "track");
    await j.expect(activeTrack).toHaveAttribute("data-track", chosen().id);
    await j.shot("a", "10-back-to-circuit");
    await nav.getByRole("button", { name: /GARAGE/ }).click();
    await j.expect(deck).toHaveAttribute("data-screen", "garage");
    await j.expect(activeCar).toHaveAttribute("data-variant", "suv");
    await j.shot("a", "11-back-to-garage");
    await selectCar.click();
    await selectTrack.click();
    await j.expect(deck).toHaveAttribute("data-screen", "settings");
  });

  await j.step("player picks Hard and creates a Room on the chosen Track", async () => {
    await a.getByRole("radio", { name: "Hard", exact: true }).click();
    await j
      .expect(a.getByRole("radio", { name: "Hard", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await a.getByLabel("Driver", { exact: true }).fill(DRIVER);
    await a.getByPlaceholder("New room name").fill(ROOM);
    await j.shot("a", "12-setup-filled");
    await a.getByRole("button", { name: "Create & Race" }).click();
    await j.expect(standings(a)).toContainText(DRIVER, { timeout: 60_000 });
  });

  await j.step("the HUD shows the chosen Track", async () => {
    await j.expect(a.locator(".hud-map")).toContainText(chosen().name.replace(" Circuit", ""));
    await j.expect(a.locator(".hud-room")).toContainText(ROOM);
    await j.shot("a", "13-hud-track");
  });

  await j.step("server joined message and rooms row carry the Track and Difficulty", async () => {
    await j.expect.poll(() => j.received("a", "joined").length).toBeGreaterThan(0);
    const joined = j.received("a", "joined").at(-1);
    j.json("joined-message", joined);
    j.expect(joined.track).toBe(chosen().id);
    j.expect(joined.difficulty).toBe("hard");
    const rows = await j.sql("SELECT name, track, difficulty FROM rooms WHERE name = $1", [ROOM]);
    j.json("db-rooms", rows);
    j.expect(rows).toHaveLength(1);
    j.expect(rows[0].track).toBe(chosen().id);
    j.expect(rows[0].difficulty).toBe("hard");
  });

  async function selectCarCard(variant) {
    const card = a.locator(`.garage-card[data-variant="${variant}"]`);
    await card.click();
    await j.expect(card).toHaveAttribute("aria-checked", "true");
  }
});
