import { useCallback, useContext, useEffect, useRef } from "react";
import { useStoreApi } from "reactflow";
import { InteractivityGraphContext } from "../InteractivityGraphContext";
import { useDevicePixelRatio } from "../hooks/useDevicePixelRatio";

// The LOD box's dotted warning border (see flow-node--warning in flowNodes.css) is 5px in
// graph-space, so it scales down with zoom like everything else in the pane. Below this zoom it
// renders under a screen pixel or two and stops reading as "dotted" at all. Below it, warnings
// are instead called out with a fixed-screen-size ring drawn on this canvas overlay (outside
// reactflow's zoom-transformed pane), so it stays legible regardless of how far zoomed out.
export const WARNING_ANNOTATION_ZOOM_THRESHOLD = 0.15;

const RING_RADIUS = 14;
const RING_WIDTH = 3;
const RING_COLOR = "#e02020";

// stand-ins matching AuthoringGraphNode's LOD box, for nodes reactflow has not measured yet
const UNMEASURED_NODE_WIDTH = 280;
const UNMEASURED_NODE_HEIGHT = 120;

/**
 * Canvas overlay that rings warning nodes once they're too small on screen for the LOD box's
 * dotted border to read. Painted imperatively straight from the reactflow store (like
 * GraphMiniMap) so panning/zooming never triggers a React re-render of this layer.
 */
export const NodeWarningAnnotations = () => {
    const store = useStoreApi();
    const { nodeWarnings, diagnosticsByNodeUid } = useContext(InteractivityGraphContext);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const frameRef = useRef<number | null>(null);
    const devicePixelRatio = useDevicePixelRatio();

    // read inside draw() via ref so store-driven repaints (pan/zoom) don't need to depend on
    // these, and don't need to be recreated when they change
    const warningsRef = useRef({ nodeWarnings, diagnosticsByNodeUid });
    warningsRef.current = { nodeWarnings, diagnosticsByNodeUid };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) { return; }
        const state = store.getState();
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.round(state.width * dpr);
        const targetHeight = Math.round(state.height * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) { return; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, state.width, state.height);

        const [tx, ty, zoom] = state.transform;
        if (zoom >= WARNING_ANNOTATION_ZOOM_THRESHOLD) { return; }

        const { nodeWarnings: warnings, diagnosticsByNodeUid: diagnostics } = warningsRef.current;
        if (Object.keys(warnings).length === 0 && diagnostics.size === 0) { return; }

        ctx.strokeStyle = RING_COLOR;
        ctx.lineWidth = RING_WIDTH;
        state.nodeInternals.forEach((node) => {
            const uid = node.data?.uid;
            if (!uid) { return; }
            const hasWarning = (warnings[uid]?.length ?? 0) > 0 || (diagnostics.get(uid)?.length ?? 0) > 0;
            if (!hasWarning) { return; }
            const { x, y } = node.positionAbsolute ?? node.position;
            const w = node.width ?? UNMEASURED_NODE_WIDTH;
            const h = node.height ?? UNMEASURED_NODE_HEIGHT;
            const cx = (x + w / 2) * zoom + tx;
            const cy = (y + h / 2) * zoom + ty;
            ctx.beginPath();
            ctx.arc(cx, cy, RING_RADIUS, 0, Math.PI * 2);
            ctx.stroke();
        });
    }, [store]);

    const scheduleDraw = useCallback(() => {
        if (frameRef.current !== null) { return; }
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            draw();
        });
    }, [draw]);

    useEffect(() => {
        scheduleDraw();
        // subscribe to the whole store rather than useStore-with-selector: pan/zoom repaints the
        // canvas directly, no React re-render per frame
        const unsubscribe = store.subscribe(scheduleDraw);
        return () => {
            unsubscribe();
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [store, scheduleDraw]);

    // these don't flow through the store subscription above, so they need their own trigger
    useEffect(() => {
        scheduleDraw();
    }, [nodeWarnings, diagnosticsByNodeUid, devicePixelRatio, scheduleDraw]);

    return <canvas ref={canvasRef} className={"node-warning-annotations"} />;
};
