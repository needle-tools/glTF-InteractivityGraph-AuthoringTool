import { attachPointerTap } from "../src/integrations/pointerTap";
import { jest } from "@jest/globals";

describe("attachPointerTap", () => {
    let element: HTMLDivElement;
    let onTap: jest.Mock;
    let detach: () => void;

    beforeEach(() => {
        element = document.createElement("div");
        onTap = jest.fn();
        detach = attachPointerTap(element, onTap);
    });

    afterEach(() => detach());

    it("preserves ordinary mouse clicks", () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));
        expect(onTap).toHaveBeenCalledTimes(1);
    });

    it("recognizes a touch tap with normal finger movement and suppresses its synthetic click", () => {
        dispatchPointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 20 });
        dispatchPointer("pointerup", { pointerId: 1, clientX: 17, clientY: 25 });
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 17, clientY: 25 }));

        expect(onTap).toHaveBeenCalledTimes(1);
    });

    it("does not turn a camera drag into a selection", () => {
        dispatchPointer("pointerdown", { pointerId: 2, clientX: 10, clientY: 20 });
        dispatchPointer("pointerup", { pointerId: 2, clientX: 40, clientY: 50 });
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 50 }));
        expect(onTap).not.toHaveBeenCalled();
    });

    it("cancels an interrupted touch", () => {
        dispatchPointer("pointerdown", { pointerId: 3, clientX: 10, clientY: 20 });
        element.dispatchEvent(new Event("pointercancel", { bubbles: true }));
        dispatchPointer("pointerup", { pointerId: 3, clientX: 10, clientY: 20 });
        expect(onTap).not.toHaveBeenCalled();
    });

    function dispatchPointer(
        type: "pointerdown" | "pointerup",
        values: { pointerId: number; clientX: number; clientY: number },
    ): void {
        const event = new Event(type, { bubbles: true }) as PointerEvent;
        Object.defineProperties(event, {
            pointerType: { value: "touch" },
            isPrimary: { value: true },
            pointerId: { value: values.pointerId },
            clientX: { value: values.clientX },
            clientY: { value: values.clientY },
        });
        element.dispatchEvent(event);
    }
});
