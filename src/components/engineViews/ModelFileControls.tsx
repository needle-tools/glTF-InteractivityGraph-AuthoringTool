import React, { useRef } from "react";
import { Dropdown } from "react-bootstrap";
import { IconDownload, IconUpload } from "../toolbarIcons";
import { ModelExportFormat } from "./modelExport";
import { entriesFromFileList, ModelFileEntry } from "./modelFiles";

interface ModelFileControlsProps {
    hasModel: boolean;
    inputTestId: string;
    downloadTestId: string;
    onSelectFiles: (entries: ModelFileEntry[]) => void;
    onExport: (format: ModelExportFormat) => void;
}

/** Toolbar upload (.glb, or a .gltf with its .bin and textures) and download (GLB or glTF zip). */
export const ModelFileControls: React.FC<ModelFileControlsProps> = ({ hasModel, inputTestId, downloadTestId, onSelectFiles, onExport }) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    return (
        <>
            <span className={"panel__toolbar-label"}>Model</span>
            <input className="d-none" type="file" multiple accept=".glb,.gltf,.bin,image/*" ref={fileInputRef} data-testid={inputTestId} onChange={(event) => {
                onSelectFiles(entriesFromFileList(event.target.files));
                // allow selecting the same file again
                event.target.value = "";
            }}/>
            <button type="button" className="panel__toolbar-btn" onClick={() => fileInputRef.current?.click()} title={"Select a .glb, or a .gltf together with its .bin and texture files. You can also drop files or a folder onto the page."}>
                <IconUpload/>
                Upload glb/glTF
            </button>

            <Dropdown>
                <Dropdown.Toggle as="button" type="button" className="panel__toolbar-btn" disabled={!hasModel} data-testid={downloadTestId}>
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
        </>
    );
};

export const ModelDropOverlay: React.FC<{ visible: boolean }> = ({ visible }) => visible ? (
    <div className={"model-drop-overlay"}>
        Drop a .glb, or a .gltf with its .bin and textures (or their folder)
    </div>
) : null;
