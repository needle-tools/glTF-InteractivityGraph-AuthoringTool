// Thin, dependency-free wrapper around the Needle analytics (Rybbit) script loaded in
// public/index.html. Rybbit exposes a global `rybbit` object; custom events are sent via
// `rybbit.event(name, properties)` and show up in the dashboard as a breakdown by event name +
// property. Everything here is best-effort and must never throw into the app: analytics being
// blocked, offline, or not yet loaded should be invisible to the user.

type PropValue = string | number | boolean;
type Props = Record<string, PropValue | null | undefined>;

// The subset of the Rybbit tracking API we use. The script is loaded with `defer`, so this global
// may not exist yet when the first events fire during startup (see the pending buffer below).
interface RybbitApi {
    event: (name: string, properties?: Record<string, PropValue>) => void;
    pageview?: (path?: string) => void;
}

declare global {
    interface Window {
        rybbit?: RybbitApi;
    }
}

const getRybbit = (): RybbitApi | undefined => {
    if (typeof window === "undefined") { return undefined; }
    const rybbit = window.rybbit;
    return rybbit && typeof rybbit.event === "function" ? rybbit : undefined;
};

// Events fired before the deferred script has initialised are buffered here and flushed once
// `window.rybbit` appears. Capped so an early burst can't grow unbounded if the script is blocked.
const pending: Array<[string, Record<string, PropValue> | undefined]> = [];
const MAX_PENDING = 100;
let flushTimer: number | null = null;
let flushAttempts = 0;
const MAX_FLUSH_ATTEMPTS = 40; // ~12s of polling at 300ms, then give up

const stopFlushing = () => {
    if (flushTimer !== null) {
        window.clearInterval(flushTimer);
        flushTimer = null;
    }
};

const flushPending = () => {
    const rybbit = getRybbit();
    if (!rybbit) {
        // keep waiting for the deferred script, but don't poll forever if it never loads
        if (++flushAttempts >= MAX_FLUSH_ATTEMPTS) {
            pending.length = 0;
            stopFlushing();
        }
        return;
    }
    while (pending.length > 0) {
        const [name, props] = pending.shift()!;
        try {
            rybbit.event(name, props);
        } catch {
            // analytics must never break the app
        }
    }
    stopFlushing();
};

const scheduleFlush = () => {
    if (flushTimer !== null || typeof window === "undefined") { return; }
    flushAttempts = 0;
    flushTimer = window.setInterval(flushPending, 300);
};

// Rybbit only accepts scalar property values; drop nullish entries and coerce the rest so a stray
// object/array can't make the whole event silently fail.
const sanitizeProps = (props?: Props): Record<string, PropValue> | undefined => {
    if (!props) { return undefined; }
    const cleaned: Record<string, PropValue> = {};
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined) { continue; }
        cleaned[key] = typeof value === "object" ? String(value) : value;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

/**
 * Send a custom analytics event. Safe to call anywhere; failures are swallowed and events fired
 * before the analytics script loads are buffered and flushed once it is ready.
 */
export const trackEvent = (event: string, props?: Props): void => {
    try {
        const cleaned = sanitizeProps(props);
        const rybbit = getRybbit();
        if (rybbit) {
            rybbit.event(event, cleaned);
            return;
        }
        pending.push([event, cleaned]);
        if (pending.length > MAX_PENDING) { pending.shift(); }
        scheduleFlush();
    } catch {
        // analytics must never break the app
    }
};

// Per-key timestamps for throttling high-frequency events (scene hover/select, wiring edges) so a
// burst of interactions collapses to at most one event per window instead of flooding the dashboard.
const lastFiredAt = new Map<string, number>();

/**
 * Like {@link trackEvent}, but fires at most once per `windowMs` for a given `throttleKey`.
 * Intended for events that can repeat many times per second.
 */
export const trackEventThrottled = (
    event: string,
    props: Props | undefined,
    throttleKey: string,
    windowMs = 2000,
): void => {
    const now = Date.now();
    const last = lastFiredAt.get(throttleKey);
    if (last !== undefined && now - last < windowMs) { return; }
    lastFiredAt.set(throttleKey, now);
    trackEvent(event, props);
};

// Ops that represent a user interacting with the running 3D scene (clicking/tapping or hovering a
// model), as opposed to lifecycle (onStart/onTick) or logic/math nodes. Only these are reported as
// scene interactions so we can see how people interact with a loaded scene without flooding on the
// per-frame onTick node or every arithmetic node that executes.
const SCENE_INTERACTION_OPS = new Set<string>([
    "event/onSelect",
    "event/onHoverIn",
    "event/onHoverOut",
]);

/**
 * Report a node execution as a scene interaction, if its op is one of the user-interaction events.
 * Called from the engine decorators' processNodeStarted hook. Throttled per op so continuous hover
 * movement doesn't spam the dashboard.
 */
export const trackSceneInteraction = (op: string | undefined): void => {
    if (!op || !SCENE_INTERACTION_OPS.has(op)) { return; }
    trackEventThrottled("scene_interaction", { op }, `scene_interaction:${op}`, 2000);
};

/**
 * Reduce a model URL to low-cardinality props (host + file name) suitable for analytics, so the
 * dashboard groups by where models come from and which model was loaded without leaking full,
 * unbounded query strings.
 */
export const describeModelUrl = (url: string): { model: string; host: string } => {
    let host = "unknown";
    let model = url;
    try {
        const parsed = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
        host = parsed.host || "unknown";
        const fileName = parsed.pathname.split("/").filter(Boolean).pop();
        model = fileName ? decodeURIComponent(fileName) : parsed.pathname;
    } catch {
        // not a parseable URL (e.g. a bare file name) — fall back to the last path segment
        model = url.split("/").pop() || url;
    }
    return { model, host };
};
