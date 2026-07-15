const MAX_TAP_DISTANCE = 12;
const SYNTHETIC_CLICK_WINDOW_MS = 700;

interface TouchStart {
    pointerId: number;
    clientX: number;
    clientY: number;
}

export function attachPointerTap(
    element: HTMLElement,
    onTap: (event: MouseEvent | PointerEvent) => void,
): () => void {
    let touchStart: TouchStart | null = null;
    let suppressClicksUntil = 0;

    const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        touchStart = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
        };
    };
    const onPointerUp = (event: PointerEvent): void => {
        if (!touchStart || event.pointerId !== touchStart.pointerId) return;
        const distance = Math.hypot(
            event.clientX - touchStart.clientX,
            event.clientY - touchStart.clientY,
        );
        touchStart = null;
        suppressClicksUntil = performance.now() + SYNTHETIC_CLICK_WINDOW_MS;
        if (distance > MAX_TAP_DISTANCE) return;
        onTap(event);
    };
    const onPointerCancel = (): void => {
        touchStart = null;
    };
    const onClick = (event: MouseEvent): void => {
        if (performance.now() < suppressClicksUntil) return;
        onTap(event);
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    element.addEventListener("click", onClick);
    return () => {
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("pointerup", onPointerUp);
        element.removeEventListener("pointercancel", onPointerCancel);
        element.removeEventListener("click", onClick);
    };
}
