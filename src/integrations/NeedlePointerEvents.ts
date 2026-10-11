import { Object3D, Raycaster, Vector2 } from "three";
import type { Ray, Camera } from "three";
import type { ThreeLoadedModel } from "./ThreeLoadedModel";
import type { ThreeDecorator } from "../decorators/ThreeDecorator";
import { attachPointerTap } from "./pointerTap";

interface NeedleIntersection {
    object: unknown;
    point: { toArray(): number[] };
}

export interface NeedleContext {
    mainCamera: unknown;
    xrCamera?: unknown;
    xrSession?: XRSession | null;
    xr?: {
        controllers: NeedleXRController[];
        referenceSpace?: XRReferenceSpace;
    };
    renderer: {
        domElement: HTMLElement;
        xr?: {
            isPresenting: boolean;
        };
    };
}

export function attachNeedlePointerEvents(
    context: NeedleContext,
    model: ThreeLoadedModel,
    decorator: ThreeDecorator,
): () => void {
    const element = context.renderer.domElement;
    const raycaster = new Raycaster();

    const pick = (
        event: MouseEvent | PointerEvent,
        property: "hoverable" | "selectable",
    ): NeedleIntersection | undefined => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return undefined;
        const camera = context.mainCamera as Camera | undefined;
        if (!camera) return undefined;
        camera.updateWorldMatrix(true, false);
        model.scene.updateWorldMatrix(true, true);
        raycaster.setFromCamera(
            new Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1,
            ),
            camera,
        );
        const hits = raycaster.intersectObject(model.scene, true);
        return hits.find((hit) =>
            interactionEnabled(hit.object as Object3D, property),
        );
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (context.renderer.xr?.isPresenting) return;
        const hit = pick(event, "hoverable");
        decorator.hoverOn(
            hit ? findNodeIndex(hit.object as Object3D) : undefined,
            0,
        );
    };
    const onPointerLeave = (): void => {
        if (!context.renderer.xr?.isPresenting) decorator.hoverOn(undefined, 0);
    };
    const onTap = (event: MouseEvent | PointerEvent): void => {
        if (context.renderer.xr?.isPresenting) return;
        const hit = pick(event, "selectable");
        const nodeIndex = hit
            ? findNodeIndex(hit.object as Object3D)
            : undefined;
        if (!hit || nodeIndex === undefined) return;
        const point = hit.point.toArray();
        const origin = raycaster.ray.origin.toArray();
        decorator.select(
            nodeIndex,
            0,
            point.slice(0, 3) as [number, number, number],
            origin.slice(0, 3) as [number, number, number],
        );
    };

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerleave", onPointerLeave);
    const detachTap = attachPointerTap(element, onTap);
    return () => {
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerleave", onPointerLeave);
        detachTap();
    };
}

interface NeedleXRController {
    index: number;
    inputSource: XRInputSource;
    connected: boolean;
    isTracking: boolean;
    ray: Ray;
}

/** Needle owns controller poses (Three controllerAutoUpdate is disabled in XR). */
export function attachNeedleXRPointerEvents(
    context: NeedleContext,
    model: ThreeLoadedModel,
    decorator: ThreeDecorator,
): { update(): void; dispose(): void } {
    const raycaster = new Raycaster();
    let session: XRSession | null | undefined;
    let disposed = false;
    const hovered = new Set<number>();
    const intersect = (property: "hoverable" | "selectable") => {
        model.scene.updateWorldMatrix(true, true);
        return raycaster
            .intersectObject(model.scene, true)
            .find((hit) => interactionEnabled(hit.object, property));
    };
    const pick = (
        controller: NeedleXRController,
        property: "hoverable" | "selectable",
    ) => {
        raycaster.ray.copy(controller.ray);
        return intersect(property);
    };
    const onSelect = (event: XRInputSourceEvent) => {
        if (
            disposed ||
            !context.renderer.xr?.isPresenting ||
            session !== context.xrSession
        )
            return;
        const controller = context.xr?.controllers.find(
            (value) => value.inputSource === event.inputSource,
        );
        if (!controller?.connected) return;
        const referenceSpace = context.xr?.referenceSpace;
        if (event.frame && referenceSpace) {
            // Selection events can arrive before Needle updates this frame's controller ray.
            const pose = event.frame.getPose(
                event.inputSource.targetRaySpace,
                referenceSpace,
            );
            if (!pose) return;
            raycaster.ray.origin.set(
                pose.transform.position.x,
                pose.transform.position.y,
                pose.transform.position.z,
            );
            raycaster.ray.direction
                .set(0, 0, -1)
                .applyQuaternion(pose.transform.orientation);
            const parent = (context.mainCamera as Object3D | undefined)?.parent;
            if (parent) {
                parent.updateWorldMatrix(true, false);
                raycaster.ray.origin.applyMatrix4(parent.matrixWorld);
                raycaster.ray.direction.transformDirection(parent.matrixWorld);
            }
        } else {
            if (!controller.isTracking) return;
            raycaster.ray.copy(controller.ray);
        }
        const hit = intersect("selectable");
        const nodeIndex = hit && findNodeIndex(hit.object);
        if (hit && nodeIndex !== undefined) {
            decorator.select(
                nodeIndex,
                controller.index,
                hit.point.toArray(),
                raycaster.ray.origin.toArray(),
            );
        }
    };
    const clearHover = () => {
        for (const index of hovered) decorator.hoverOn(undefined, index);
        hovered.clear();
    };
    const syncSession = () => {
        const next = context.xrSession;
        if (session === next) return;
        session?.removeEventListener("select", onSelect);
        clearHover();
        session = next;
        session?.addEventListener("select", onSelect);
    };
    syncSession();
    return {
        update() {
            if (disposed) return;
            syncSession();
            if (!context.renderer.xr?.isPresenting) {
                clearHover();
                return;
            }
            const active = new Set<number>();
            for (const controller of context.xr?.controllers ?? []) {
                if (!controller.connected || !controller.isTracking) continue;
                active.add(controller.index);
                const hit = pick(controller, "hoverable");
                decorator.hoverOn(
                    hit ? findNodeIndex(hit.object) : undefined,
                    controller.index,
                );
                hovered.add(controller.index);
            }
            for (const index of hovered)
                if (!active.has(index)) {
                    decorator.hoverOn(undefined, index);
                    hovered.delete(index);
                }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            session?.removeEventListener("select", onSelect);
            clearHover();
        },
    };
}

function findNodeIndex(object: Object3D): number | undefined {
    for (
        let current: Object3D | null = object;
        current;
        current = current.parent
    ) {
        if (Number.isInteger(current.userData.gltfNodeIndex))
            return current.userData.gltfNodeIndex;
    }
    return undefined;
}

function interactionEnabled(
    object: Object3D,
    property: "hoverable" | "selectable",
): boolean {
    for (
        let current: Object3D | null = object;
        current;
        current = current.parent
    ) {
        if (!current.visible || current.userData[property] === false)
            return false;
    }
    return true;
}
