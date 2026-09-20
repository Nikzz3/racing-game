import type { ModelLoadProgress } from "../game/models";

/** Covers the first asset load and stays up until the garage has drawn. */
export class LoadingScreen {
  private readonly element = document.createElement("section");
  private readonly status: HTMLElement;
  private readonly meter: HTMLProgressElement;
  private readonly amount: HTMLElement;
  private readonly lobby: HTMLElement | null;
  private closed = false;

  constructor(host: HTMLElement) {
    this.lobby = host.querySelector(".lobby");
    if (this.lobby) this.lobby.inert = true;
    this.element.className = "game-loading";
    this.element.setAttribute("aria-label", "Loading Sunset Ridge");
    this.element.innerHTML = `
      <svg class="loading-landscape" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="loading-sky" x2="0" y2="1"><stop stop-color="#344856"/><stop offset=".6" stop-color="#c59073"/><stop offset="1" stop-color="#edbb81"/></linearGradient>
          <linearGradient id="loading-road" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c8587"/><stop offset="1" stop-color="#303f49"/></linearGradient>
        </defs>
        <path fill="url(#loading-sky)" d="M0 0h1440v900H0z"/>
        <circle cx="1050" cy="342" r="106" fill="#f8d5a1"/>
        <path fill="#8d8582" d="m0 464 185-160 122 94 221-216 240 221 152-72 215 156 197-201 108 102v512H0z"/>
        <path fill="#616d72" d="m0 527 253-172 154 101 186-61 165 139 202-132 211 135 174-31 95 44v350H0z"/>
        <path fill="#3c525a" d="m0 616 242-113 239 72 197-99 309 147 224-96 229 149v224H0z"/>
        <path fill="#233b43" d="m0 674 245 61 370-182 273 106 195 22 357 153v66H0z"/>
        <path d="M675 527c125 19 225 57 167 98-62 44-337 71-243 125 75 44 309 9 420 74 37 22 52 49 43 96" fill="none" stroke="#b4b0a0" stroke-width="55"/>
        <path d="M675 527c125 19 225 57 167 98-62 44-337 71-243 125 75 44 309 9 420 74 37 22 52 49 43 96" fill="none" stroke="url(#loading-road)" stroke-width="47"/>
        <path d="M675 527c125 19 225 57 167 98-62 44-337 71-243 125 75 44 309 9 420 74 37 22 52 49 43 96" fill="none" stroke="#e7c68b" stroke-width="2" stroke-dasharray="13 15"/>
        <path fill="#172e35" d="m0 699 137 50 115-17 115 61 217 107H0zm1261-1 31-78 31 78h-18v55h-26v-55zm85 86 40-108 40 108h-24v70h-32v-70z"/>
      </svg>
      <div class="loading-shade" aria-hidden="true"></div>
      <div class="loading-title"><img src="${import.meta.env.BASE_URL}favicon.svg" width="46" height="46" alt=""/><h1>Sunset<br>Ridge</h1></div>
      <div class="loading-footer">
        <div class="loading-activity">
          <div class="loading-status-row"><span class="loading-status" role="status" aria-live="polite">Loading your garage</span><span class="loading-amount" aria-hidden="true"></span></div>
          <progress class="loading-meter" aria-label="Garage model download"></progress>
          <div class="loading-error-actions" hidden><button type="button" data-loading-retry>Try again</button><button type="button" data-loading-continue>Continue without 3D</button></div>
        </div>
      </div>`;
    this.status = this.element.querySelector(".loading-status")!;
    this.meter = this.element.querySelector("progress")!;
    this.amount = this.element.querySelector(".loading-amount")!;
    this.element.querySelector<HTMLButtonElement>("[data-loading-retry]")!.onclick = () =>
      location.reload();
    this.element.querySelector<HTMLButtonElement>("[data-loading-continue]")!.onclick = () =>
      this.dismiss();
    host.append(this.element);
  }

  update(progress: ModelLoadProgress): void {
    if (this.closed) return;
    if (progress.phase === "error") {
      this.fail("The garage could not download. Check your connection and try again.");
      return;
    }
    this.status.textContent =
      progress.phase === "loading" ? "Loading your garage" : "Opening the garage";
    if (progress.phase === "loading" && progress.total > 0) {
      this.meter.max = progress.total;
      this.meter.value = progress.loaded;
      this.amount.textContent = `${Math.min(100, Math.floor((progress.loaded / progress.total) * 100))}%`;
    } else {
      this.meter.removeAttribute("value");
      this.amount.textContent = "";
    }
  }

  fail(message: string): void {
    this.status.textContent = message;
    this.element.dataset.state = "error";
    this.meter.hidden = true;
    this.amount.textContent = "";
    this.element.querySelector<HTMLElement>(".loading-error-actions")!.hidden = false;
  }

  dismiss(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.lobby) this.lobby.inert = false;
    this.element.setAttribute("aria-hidden", "true");
    this.element.inert = true;
    this.element.classList.add("is-ready");
    // A timeout also removes the overlay when transitions are disabled.
    window.setTimeout(() => this.element.remove(), 320);
  }
}
