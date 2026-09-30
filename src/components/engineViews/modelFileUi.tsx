import React, { useEffect, useRef, useState } from "react";
import { Dropdown } from "react-bootstrap";
import { IconDownload } from "../toolbarIcons";
import type { ModelExportFormat } from "./modelExport";
import { entriesFromDataTransfer, type ModelFileEntry } from "./modelFiles";

/**
 * Loads files dropped anywhere on the page as the viewport's model; a folder drop keeps its
 * subfolders. Returns whether files are being dragged over the page (for the overlay). Drags that
 * carry no files, such as the graph editor's own, are left alone.
 */
export const useModelFileDrop = (onFiles: (entries: ModelFileEntry[]) => void): boolean => {
    const [dragging, setDragging] = useState(false);
    // the latest handler, so the window listeners are registered only once
    const onFilesRef = useRef(onFiles);
    onFilesRef.current = onFiles;

    useEffect(() => {
        let dragDepth = 0;
        const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
        const onDragEnter = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            dragDepth++;
            setDragging(true);
        };
        const onDragOver = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            event.dataTransfer!.dropEffect = "copy";
        };
        const onDragLeave = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) { setDragging(false); }
        };
        const onDrop = (event: DragEvent) => {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            dragDepth = 0;
            setDragging(false);
            entriesFromDataTransfer(event.dataTransfer!).then(
                (entries) => onFilesRef.current(entries),
                (error) => console.error("Failed to read dropped files:", error),
            );
        };
        window.addEventListener("dragenter", onDragEnter);
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragenter", onDragEnter);
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
        };
    }, []);

    return dragging;
};

export const ModelDropOverlay: React.FC<{ visible: boolean }> = ({ visible }) => visible ? (
    <div className={"model-drop-overlay"}>
        Drop a .glb, or a .gltf with its .bin and textures (or their folder)
    </div>
) : null;

/** file picker hint shared by the viewports' upload buttons */
export const MODEL_UPLOAD_TITLE = "Select a .glb, or a .gltf together with its .bin and texture files. You can also drop files or a folder onto the page.";
export const MODEL_UPLOAD_ACCEPT = ".glb,.gltf,.bin,image/*";

/** toolbar Download menu: the model with the graph embedded, as .glb or as a zipped .gltf */
export const ModelDownloadMenu: React.FC<{ disabled: boolean; testId: string; onExport: (format: ModelExportFormat) => void }> = ({ disabled, testId, onExport }) => (
    <Dropdown>
        <Dropdown.Toggle as="button" type="button" className="panel__toolbar-btn" disabled={disabled} data-testid={testId}>
            <IconDownload/>
            Download
        </Dropdown.Toggle>
        <Dropdown.Menu>
            <Dropdown.Item onClick={() => onExport("glb")}>
                GLB (.glb, single file)
            </Dropdown.Item>
            <Dropdown.Item onClick={() => onExport("gltf-zip")}>
                glTF (.zip with .gltf, .bin and textures)
            </Dropdown.Item>
        </Dropdown.Menu>
    </Dropdown>
);
