import type { Object3D } from "three";
import type { ThreeLoadedModel } from "./threeLoadedModel";
import type { ThreeDecorator } from "../../decorators/ThreeDecorator";

interface NeedleIntersection {
    object: unknown;
    point: { toArray(): number[] };
}

export interface NeedleContext {
    mainCamera: unknown;
    renderer: { domElement: HTMLElement };
    physics: {
        raycaster?: { ray: { origin: { toArray(): number[] } } };
        raycast(options: {
            cam: unknown;
            screenPoint: { x: number; y: number };
            targets: unknown[];
            recursive: boolean;
            useAcceleratedRaycast: boolean;
            allowSlowRaycastFallback: boolean;
        }): NeedleIntersection[];
    };
}

export function attachNeedlePointerEvents(
    context: NeedleContext,
    model: ThreeLoadedModel,
    decorator: ThreeDecorator,
): () => void {
    const element = context.renderer.domElement;

    const pick = (event: MouseEvent | PointerEvent, property: "hoverable" | "selectable"): NeedleIntersection | undefined => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return undefined;
        const hits = context.physics.raycast({
            cam: context.mainCamera,
            screenPoint: {
                x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
                y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
            },
            targets: model.scene.children,
            recursive: true,
            useAcceleratedRaycast: false,
            allowSlowRaycastFallback: true,
        });
        return hits.find((hit) => interactionEnabled(hit.object as Object3D, property));
    };

    const onPointerMove = (event: PointerEvent): void => {
        const hit = pick(event, "hoverable");
        decorator.hoverOn(hit ? findNodeIndex(hit.object as Object3D) : undefined, 0);
    };
    const onPointerLeave = (): void => decorator.hoverOn(undefined, 0);
    const onClick = (event: MouseEvent): void => {
        const hit = pick(event, "selectable");
        const nodeIndex = hit ? findNodeIndex(hit.object as Object3D) : undefined;
        if (!hit || nodeIndex === undefined) return;
        const point = hit.point.toArray();
        const origin = context.physics.raycaster?.ray.origin.toArray();
        decorator.select(
            nodeIndex,
            0,
            point.slice(0, 3) as [number, number, number],
            origin?.slice(0, 3) as [number, number, number] | undefined,
        );
    };

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("click", onClick);
    return () => {
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerleave", onPointerLeave);
        element.removeEventListener("click", onClick);
    };
}

function findNodeIndex(object: Object3D): number | undefined {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (Number.isInteger(current.userData.gltfNodeIndex)) return current.userData.gltfNodeIndex;
    }
    return undefined;
}

function interactionEnabled(object: Object3D, property: "hoverable" | "selectable"): boolean {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (current.userData[property] === false) return false;
    }
    return true;
}
