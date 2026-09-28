import type { FieldFillOutcome, FillResult } from "./types.js";
import { countHighConfidenceFilled } from "./types.js";
import { isolateExtensionUiClicks } from "../../src/extensionClickIsolation.js";
import { broadcastJumpToField } from "./iframe-bridge.js";
import { highlightFieldAtSelector } from "./field-highlight.js";
import { querySelectorDeep } from "./fill-utils.js";

export interface TailoredSessionOption {
  jd_id: string;
  title: string;
  company: string;
}

export interface OverlayOfferContext {
  title: string;
  company: string;
}

export type OverlayView = "hidden" | "offer" | "result" | "picker";

export interface AutofillOverlayCallbacks {
  onAutofillConfirm: (jdId: string) => void;
  onSessionPick: (jdId: string) => void;
  onDismiss: () => void;
}

const DISMISS_STORAGE_PREFIX = "flint_autofill_dismissed:";

const OVERLAY_STYLES = `
  :host {
    all: initial;
    display: block;
    position: fixed;
    inset: 0;
    width: 0;
    height: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 2147483646;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    color: #0f172a;
  }
  .panel {
    position: fixed;
    /* Above the Flint FAB (56px + 20px margin). */
    right: 20px;
    bottom: 88px;
    pointer-events: auto;
    width: 320px;
    max-width: calc(100vw - 32px);
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
    padding: 14px;
  }
  .title {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .subtitle {
    margin: 0 0 12px;
    color: #475569;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 8px 12px;
  }
  .btn-primary {
    background: #0f766e;
    color: #fff;
  }
  .btn-secondary {
    background: #f8fafc;
    border-color: #cbd5e1;
    color: #0f172a;
  }
  .btn-ghost {
    background: transparent;
    color: #64748b;
    padding-inline: 4px;
  }
  .review-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    max-height: 180px;
    overflow: auto;
  }
  .review-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #e2e8f0;
    font-size: 13px;
  }
  .review-item:last-child {
    border-bottom: none;
  }
  .review-label {
    color: #334155;
  }
  .review-status {
    color: #64748b;
    font-size: 12px;
  }
  .picker-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  .picker-item {
    width: 100%;
    text-align: left;
    margin-bottom: 6px;
  }
  .note {
    margin: 0 0 10px;
    font-size: 12px;
    color: #64748b;
  }
`;

function dismissStorageKey(pageUrl: string): string {
  return `${DISMISS_STORAGE_PREFIX}${pageUrl}`;
}

function humanizeFieldKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function reviewStatusLabel(status: FieldFillOutcome["status"]): string {
  switch (status) {
    case "filled_needs_review":
      return "Needs review";
    case "not_found":
      return "Not found";
    case "not_applicable_file_upload":
      return "Attach manually";
    default:
      return status;
  }
}

function fieldsNeedingAttention(fields: FieldFillOutcome[]): FieldFillOutcome[] {
  return fields.filter(
    (f) =>
      f.status === "filled_needs_review" ||
      f.status === "not_found" ||
      f.status === "not_applicable_file_upload",
  );
}

export class AutofillOverlay {
  private readonly callbacks: AutofillOverlayCallbacks;
  private readonly pageUrl: string;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;
  private view: OverlayView = "hidden";

  constructor(callbacks: AutofillOverlayCallbacks, pageUrl = globalThis.location?.href ?? "") {
    this.callbacks = callbacks;
    this.pageUrl = pageUrl;
  }

  getHost(): HTMLElement | null {
    return this.host;
  }

  mount(anchor: HTMLElement = document.body): void {
    if (this.host?.parentElement === anchor) return;

    if (this.host) {
      anchor.appendChild(this.host);
      return;
    }

    this.host = document.createElement("div");
    this.host.setAttribute("data-flint-autofill-overlay", "true");
    this.shadow = this.host.attachShadow({ mode: "open" });
    isolateExtensionUiClicks(this.host, this.shadow);

    const style = document.createElement("style");
    style.textContent = OVERLAY_STYLES;
    this.shadow.appendChild(style);

    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.hidden = true;
    this.shadow.appendChild(this.panel);

    anchor.appendChild(this.host);
  }

  getView(): OverlayView {
    return this.view;
  }

  isDismissedForPage(): boolean {
    try {
      return sessionStorage.getItem(dismissStorageKey(this.pageUrl)) === "1";
    } catch {
      return false;
    }
  }

  markDismissed(): void {
    try {
      sessionStorage.setItem(dismissStorageKey(this.pageUrl), "1");
    } catch {
      // sessionStorage unavailable — dismiss for this runtime only.
    }
    this.hide();
    this.callbacks.onDismiss();
  }

  showOffer(context: OverlayOfferContext, jdId: string): void {
    if (this.isDismissedForPage()) return;
    this.renderPanel((panel) => {
      const heading = document.createElement("p");
      heading.className = "title";
      heading.textContent = "Autofill from your tailored resume?";

      const subtitle = document.createElement("p");
      subtitle.className = "subtitle";
      subtitle.textContent = `${context.title} · ${context.company}`;

      const actions = this.buildActions([
        {
          label: "Autofill",
          className: "btn-primary",
          onClick: () => this.callbacks.onAutofillConfirm(jdId),
        },
        {
          label: "Not now",
          className: "btn-secondary",
          onClick: () => this.markDismissed(),
        },
      ]);

      panel.append(heading, subtitle, actions);
    });
    this.view = "offer";
  }

  showPicker(sessions: TailoredSessionOption[]): void {
    if (this.isDismissedForPage()) return;
    this.renderPanel((panel) => {
      const heading = document.createElement("p");
      heading.className = "title";
      heading.textContent = "Which application is this?";

      const subtitle = document.createElement("p");
      subtitle.className = "subtitle";
      subtitle.textContent = "Pick the tailored resume to use for this form.";

      const list = document.createElement("ul");
      list.className = "picker-list";

      for (const session of sessions) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn-secondary picker-item";
        button.textContent = `${session.title} · ${session.company}`;
        button.addEventListener("click", () => this.callbacks.onSessionPick(session.jd_id));
        item.appendChild(button);
        list.appendChild(item);
      }

      const dismiss = this.buildActions([
        {
          label: "Not now",
          className: "btn-ghost",
          onClick: () => this.markDismissed(),
        },
      ]);

      panel.append(heading, subtitle, list, dismiss);
    });
    this.view = "picker";
  }

  showResult(result: FillResult): void {
    this.renderPanel((panel) => {
      const reviewFields = fieldsNeedingAttention(result.fields);
      const highConfidence = countHighConfidenceFilled(result.fields);
      const needsReviewOnly = result.fields.filter((f) => f.status === "filled_needs_review").length;

      const heading = document.createElement("p");
      heading.className = "title";
      heading.textContent = `${result.percent_filled}% filled`;

      const subtitle = document.createElement("p");
      subtitle.className = "subtitle";
      if (reviewFields.length === 0) {
        subtitle.textContent = "All fillable fields were handled automatically.";
      } else if (needsReviewOnly > 0 && highConfidence === 0) {
        subtitle.textContent = `${needsReviewOnly} field${needsReviewOnly === 1 ? "" : "s"} filled — please verify each value before submitting.`;
      } else {
        subtitle.textContent = `${reviewFields.length} field${reviewFields.length === 1 ? "" : "s"} still need your attention (verify values, attach resume, or complete manually).`;
      }

      panel.append(heading, subtitle);

      if (reviewFields.length > 0) {
        const list = document.createElement("ul");
        list.className = "review-list";

        for (const field of reviewFields) {
          const item = document.createElement("li");
          item.className = "review-item";

          const label = document.createElement("span");
          label.className = "review-label";
          label.textContent = humanizeFieldKey(field.key);

          const meta = document.createElement("span");
          meta.className = "review-status";
          meta.textContent = reviewStatusLabel(field.status);

          item.append(label, meta);

          if (field.selector && field.status !== "not_applicable_file_upload") {
            const jump = document.createElement("button");
            jump.type = "button";
            jump.className = "btn-secondary";
            jump.textContent = "Jump to field";
            jump.addEventListener("click", () => this.jumpToField(field.selector));
            item.appendChild(jump);
          }

          list.appendChild(item);
        }

        panel.appendChild(list);
      }

      const fileNote = result.fields.some((f) => f.status === "not_applicable_file_upload");
      if (fileNote) {
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = "Resume/file uploads must be attached manually.";
        panel.appendChild(note);
      }

      const actions = this.buildActions([
        {
          label: "Dismiss",
          className: "btn-secondary",
          onClick: () => this.markDismissed(),
        },
      ]);
      panel.appendChild(actions);
    });
    this.view = "result";
  }

  jumpToField(selector: string | null): void {
    if (!selector) return;
    const highlighted = highlightFieldAtSelector(document, selector);
    if (!highlighted) {
      broadcastJumpToField(selector);
    }
  }

  showMessage(title: string, subtitle: string): void {
    this.renderPanel((panel) => {
      const heading = document.createElement("p");
      heading.className = "title";
      heading.textContent = title;

      const body = document.createElement("p");
      body.className = "subtitle";
      body.textContent = subtitle;

      const actions = this.buildActions([
        {
          label: "Dismiss",
          className: "btn-secondary",
          onClick: () => this.markDismissed(),
        },
      ]);

      panel.append(heading, body, actions);
    });
    this.view = "result";
  }

  hide(): void {
    if (this.panel) {
      this.panel.hidden = true;
      this.panel.replaceChildren();
    }
    this.view = "hidden";
  }

  destroy(): void {
    this.hide();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.panel = null;
  }

  private renderPanel(build: (panel: HTMLElement) => void): void {
    if (!this.panel) this.mount();
    if (!this.panel) return;
    this.panel.replaceChildren();
    build(this.panel);
    this.panel.hidden = false;
  }

  private buildActions(
    actions: Array<{ label: string; className: string; onClick: () => void }>,
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.textContent = action.label;
      const run = (): void => {
        action.onClick();
      };
      for (const type of ["pointerdown", "mousedown"] as const) {
        button.addEventListener(
          type,
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          },
          true,
        );
      }
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          run();
        },
        true,
      );
      container.appendChild(button);
    }
    return container;
  }
}
