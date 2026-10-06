import { useEffect, useRef, useState } from "react";
import { entriesFromDataTransfer, ModelFileEntry } from "../components/engineViews/modelFiles";

/**
 * Files dropped anywhere on the page are read (folders recursively, keeping subfolders) and passed
 * to onDrop, like an upload. Returns whether files are currently dragged over the page.
 */
export function useModelFileDrop(onDrop: (entries: ModelFileEntry[]) => void): boolean {
    const [dragging, setDragging] = useState(false);
    const onDropRef = useRef(onDrop);
    onDropRef.current = onDrop;

    useEffect(() => {
        let dragDepth = 0;
        const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
        const handleDragEnter = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            dragDepth++;
            setDragging(true);
        };
        const handleDragOver = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            event.dataTransfer!.dropEffect = "copy";
        };
        const handleDragLeave = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) { setDragging(false); }
        };
        const handleDrop = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            dragDepth = 0;
            setDragging(false);
            entriesFromDataTransfer(event.dataTransfer!).then(
                (entries) => onDropRef.current(entries),
                (error) => console.error("Failed to read dropped files:", error),
            );
        };
        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
        };
    }, []);

    return dragging;
}
