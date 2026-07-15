// Thin, dependency-free wrapper around the Needle analytics (Plausible-compatible) script loaded
// in public/index.html. The script exposes a global `plausible(eventName, { props })` function;
// custom events show up in the dashboard as a breakdown by event name + property. Everything here
// is best-effort and must never throw into the app: analytics being blocked, offline, or not yet
// loaded should be invisible to the user.

type PropValue = string | number | boolean;
type Props = Record<string, PropValue | null | undefined>;

// Plausible's queue stub: calls made before script.js finishes loading are buffered on `q` and
// flushed once it initialises. Declaring it here means a tracked event fired during startup is not
// lost. Mirrors the snippet Plausible documents for manual/custom events.
interface PlausibleFn {
    (event: string, options?: { props?: Record<string, PropValue> }): void;
    q?: unknown[];
}

declare global {
    interface Window {
        plausible?: PlausibleFn;
    }
}

const getPlausible = (): PlausibleFn | undefined => {
    if (typeof window === "undefined") { return undefined; }
    if (!window.plausible) {
        // install the buffering stub so events fired before script.js loads are queued, not dropped
        // (canonical Plausible manual-events snippet)
        const stub = function (this: PlausibleFn, ...args: unknown[]) {
            (window.plausible!.q = window.plausible!.q || []).push(args);
        } as unknown as PlausibleFn;
        window.plausible = stub;
    }
    return window.plausible;
};

// Plausible only accepts scalar property values; drop nullish entries and coerce the rest so a
// stray object/array can't make the whole event silently fail.
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
 * Send a custom analytics event. Safe to call anywhere; failures are swallowed.
 */
export const trackEvent = (event: string, props?: Props): void => {
    try {
        const plausible = getPlausible();
        if (!plausible) { return; }
        const cleaned = sanitizeProps(props);
        plausible(event, cleaned ? { props: cleaned } : undefined);
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
