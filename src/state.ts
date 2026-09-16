import type {
  ProviderView,
  Session,
  SessionSummary,
  Settings,
  UpdateState,
} from "./types";

export interface LiveTurn {
  text: string;
  reasoning: string;
  startedAt: number;
  /** Set once the first text delta arrives; reasoning folds at that point. */
  answering: boolean;
}

export interface State {
  ready: boolean;
  sessions: SessionSummary[];
  /** null = a new, not yet persisted chat. */
  currentId: string | null;
  session: Session | null;
  /** Model used for the next new chat. */
  draft: { providerId: string; model: string } | null;
  providers: ProviderView[];
  settings: Settings;
  live: Record<string, LiveTurn>;
  /** Inline, non-persistent error per session (cleared on the next attempt). */
  errors: Record<string, string>;
  view: "chat" | "settings";
  editing: boolean;
  pickerOpen: boolean;
  renamingId: string | null;
  /** This build's version and, when the release feed has a newer one, that update. */
  version: string;
  update: UpdateState | null;
  /** Outcome of a manual "Check for Updates…" that found nothing (cleared after a moment). */
  updateCheck: "idle" | "checking" | "uptodate" | "failed";
  fatal: string | null;
}

type Listener<T> = (payload: T) => void;

class Store {
  state: State = {
    ready: false,
    sessions: [],
    currentId: null,
    session: null,
    draft: null,
    providers: [],
    settings: {
      schema_version: 1,
      appearance: "system",
      max_tokens: 8192,
      sidebar_visible: true,
      inspector_visible: false,
      quick_shortcut: "Alt+Space",
    },
    live: {},
    errors: {},
    view: "chat",
    editing: false,
    pickerOpen: false,
    renamingId: null,
    version: "",
    update: null,
    updateCheck: "idle",
    fatal: null,
  };

  private stateListeners = new Set<Listener<State>>();
  private liveListeners = new Set<Listener<string>>();
  private pendingLive = new Set<string>();
  private frame = 0;

  set(patch: Partial<State>) {
    Object.assign(this.state, patch);
    for (const l of this.stateListeners) l(this.state);
  }

  subscribe(l: Listener<State>): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  /** Streaming deltas: mutate in place and publish at most once per frame. */
  appendLive(sessionId: string, kind: "text" | "reasoning", delta: string) {
    let live = this.state.live[sessionId];
    if (!live) {
      live = {
        text: "",
        reasoning: "",
        startedAt: performance.now(),
        answering: false,
      };
      this.state.live[sessionId] = live;
    }
    if (kind === "text") {
      live.text += delta;
      live.answering = true;
    } else {
      live.reasoning += delta;
    }
    this.pendingLive.add(sessionId);
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const ids = [...this.pendingLive];
        this.pendingLive.clear();
        for (const id of ids) for (const l of this.liveListeners) l(id);
      });
    }
  }

  onLive(l: Listener<string>): () => void {
    this.liveListeners.add(l);
    return () => this.liveListeners.delete(l);
  }

  get current(): Session | null {
    return this.state.session;
  }

  isStreaming(sessionId: string | null): boolean {
    return sessionId !== null && sessionId in this.state.live;
  }
}

export const store = new Store();
