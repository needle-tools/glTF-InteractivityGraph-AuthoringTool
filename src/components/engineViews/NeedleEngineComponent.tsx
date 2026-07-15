import "needle-engine-runtime";
import { fitCamera } from "needle-engine-runtime";
import React, { useContext, useEffect, useRef, useState } from "react";
import { Button, Container, Modal } from "react-bootstrap";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { IInteractivityGraph } from "../../BasicBehaveEngine/types/InteractivityGraph";
import { InteractivityGraphContext } from "../../InteractivityGraphContext";
import { attachPointerEventLogging, SendCustomEventPanel } from "../../authoring/CustomEventControls";
import { buildGltfObjectModel } from "../../authoring/gltfObjectModel";
import { buildNormalizedTemplateSet } from "../../authoring/pointerCatalogue";
import { computeExtensionDiagnostics } from "../../diagnostics";
import { registerNeedleInteractivity } from "../../integrations/NeedleInteractivityPlugin";
import { getInteractivityRuntime, type InteractivityRuntime } from "../../integrations/InteractivityRuntime";
import { Spacer } from "../Spacer";
import { downloadInteractivityGlb } from "./glbExport";
import { loadSelectedModelGraph } from "./modelGraphExecution";
import type { NeedleContext } from "../../integrations/NeedlePointerEvents";
import type { ThreeLoadedModel } from "./threeLoadedModel";

registerNeedleInteractivity({
    autoStart: false,
    initializeWithoutExtension: true,
});

type ModelSource = { kind: "url"; url: string } | { kind: "file"; file: File };

interface PendingLoad {
    authoredGraph: IInteractivityGraph;
    replaceAuthoringGraph: boolean;
    token: number;
}

interface NeedleLoadedModel {
    src: string;
    file: unknown;
}

interface NeedleEngineElement extends HTMLElement {
    context?: NeedleContext;
}

enum NeedleEngineModal {
    CUSTOM_EVENT = "CUSTOM_EVENT",
    NONE = "NONE",
}

interface NeedleEngineComponentProps {
    modelUrl?: string | null;
}

export const NeedleEngineComponent: React.FC<NeedleEngineComponentProps> = ({ modelUrl }) => {
    const engineElementRef = useRef<NeedleEngineElement | null>(null);
    const sourceRef = useRef<ModelSource | null>(null);
    const pendingLoadRef = useRef<PendingLoad | null>(null);
    const loadedModelRef = useRef<ThreeLoadedModel | null>(null);
    const runtimeRef = useRef<InteractivityRuntime | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const activeObjectUrlRef = useRef<string | null>(null);
    const loadTokenRef = useRef(0);
    const [modelName, setModelName] = useState<string | null>(null);
    const [graphRunning, setGraphRunning] = useState(false);
    const [openModal, setOpenModal] = useState(NeedleEngineModal.NONE);

    const {
        clearGraphDirty,
        getExecutableGraph,
        loadGraphFromJson,
        registerPlayHandler,
        setDiagnosticsForCategory,
        setGltfObjectModel,
        setSupportedPointerTemplates,
    } = useContext(InteractivityGraphContext);

    const loadSource = (
        source: ModelSource,
        authoredGraph: IInteractivityGraph,
        replaceAuthoringGraph: boolean,
    ): void => {
        const element = engineElementRef.current;
        if (!element) return;

        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        loadedModelRef.current = null;
        setGraphRunning(false);

        if (activeObjectUrlRef.current) {
            URL.revokeObjectURL(activeObjectUrlRef.current);
            activeObjectUrlRef.current = null;
        }
        const url = source.kind === "url" ? source.url : URL.createObjectURL(source.file);
        if (source.kind === "file") activeObjectUrlRef.current = url;

        const token = ++loadTokenRef.current;
        pendingLoadRef.current = { authoredGraph, replaceAuthoringGraph, token };
        sourceRef.current = source;
        setModelName(source.kind === "file" ? source.file.name : source.url.split("/").pop() ?? "model.glb");

        element.removeAttribute("src");
        requestAnimationFrame(() => {
            if (loadTokenRef.current === token) element.setAttribute("src", url);
        });
    };

    const handleLoadedModel = async (context: NeedleContext, loadedFiles: NeedleLoadedModel[]): Promise<void> => {
        const pending = pendingLoadRef.current;
        const file = loadedFiles[0]?.file;
        if (loadedFiles.length === 0) return;
        if (!pending || typeof file !== "object" || file === null || !("parser" in file)) {
            throw new Error("Needle Engine did not return a glTF model for the selected source");
        }

        const runtime = getInteractivityRuntime(file as unknown as GLTF);
        if (!runtime) throw new Error("GLTFInteractivityPlugin did not attach a runtime");
        const model = runtime.model;
        if (pending.token !== loadTokenRef.current) {
            runtime.dispose();
            return;
        }
        loadedModelRef.current = model;
        runtimeRef.current = runtime;

        const gltf = model.gltf;
        setDiagnosticsForCategory(
            "extension",
            computeExtensionDiagnostics(gltf.extensionsUsed, gltf.extensionsRequired),
        );
        setGltfObjectModel(buildGltfObjectModel(gltf));

        const decorator = runtime.decorator;
        attachPointerEventLogging(decorator);
        setSupportedPointerTemplates(buildNormalizedTemplateSet(decorator.getRegisteredJsonPointers()));

        const interactivity = gltf.extensions?.KHR_interactivity;
        const embeddedGraph = interactivity?.graphs?.[interactivity.graph ?? 0];
        await loadSelectedModelGraph({
            authoredGraph: pending.authoredGraph,
            embeddedGraph,
            replaceAuthoringGraph: pending.replaceAuthoringGraph,
            loadGraphFromJson,
            loadBehaveGraph: (graph) => decorator.loadBehaveGraph(graph),
        });
        fitCamera({
            context,
            objects: (file as unknown as { scene: unknown }).scene,
            fitOffset: 1.2,
            relativeCameraOffset: { y: 0.2 },
            cameraNearFar: "auto",
        });
        setGraphRunning(true);
        clearGraphDirty();
    };

    const play = (): void => {
        if (sourceRef.current) loadSource(sourceRef.current, getExecutableGraph(), false);
    };
    const playRef = useRef(play);
    playRef.current = play;

    const frameModel = (): void => {
        const context = engineElementRef.current?.context;
        const model = loadedModelRef.current;
        if (context && model) {
            fitCamera({
                context,
                objects: model.scene,
                fitOffset: 1.2,
                relativeCameraOffset: { y: 0.2 },
                cameraNearFar: "auto",
            });
        }
    };

    const downloadGlb = (): void => {
        const source = sourceRef.current;
        if (source?.kind === "file") void downloadInteractivityGlb(source.file, getExecutableGraph());
    };

    useEffect(() => {
        const element = engineElementRef.current;
        if (!element) return;
        const onLoadFinished = (event: Event): void => {
            const detail = (event as CustomEvent<{ context: NeedleContext; loadedFiles: NeedleLoadedModel[] }>).detail;
            void handleLoadedModel(detail.context, detail.loadedFiles).catch((error) => {
                console.error("Error loading model in Needle engine", error);
            });
        };
        element.addEventListener("loadfinished", onLoadFinished);
        return () => element.removeEventListener("loadfinished", onLoadFinished);
    }, []);

    useEffect(() => {
        registerPlayHandler(() => playRef.current());
        return () => registerPlayHandler(null);
    }, []);

    useEffect(() => {
        if (modelUrl && engineElementRef.current) {
            loadSource({ kind: "url", url: modelUrl }, getExecutableGraph(), true);
        }
    }, [modelUrl]);

    useEffect(() => () => {
        loadTokenRef.current += 1;
        runtimeRef.current?.dispose();
        if (activeObjectUrlRef.current) URL.revokeObjectURL(activeObjectUrlRef.current);
        setSupportedPointerTemplates(null);
    }, []);

    return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="engine-toolbar">
                <Button variant="outline-light" onClick={play} disabled={!modelName}>Play</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={() => setOpenModal(NeedleEngineModal.CUSTOM_EVENT)} disabled={!graphRunning}>Send Custom Event</Button>
                <Spacer width={16} height={0}/>
                <input
                    className="d-none"
                    type="file"
                    accept=".glb"
                    ref={fileInputRef}
                    data-testid="needle-engine-file-input"
                    onChange={() => {
                        const file = fileInputRef.current?.files?.[0];
                        if (file) loadSource({ kind: "file", file }, getExecutableGraph(), true);
                    }}
                />
                <Button variant="outline-light" onClick={() => fileInputRef.current?.click()}>Upload glb</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={downloadGlb} disabled={sourceRef.current?.kind !== "file"}>Download glb</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={frameModel} disabled={!modelName}>Auto Frame</Button>
            </div>

            <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#fff" }}>
                {React.createElement("needle-engine", {
                    ref: (element: HTMLElement | null) => engineElementRef.current = element as NeedleEngineElement | null,
                    "camera-controls": "true",
                    "auto-fit": "false",
                    autoplay: "false",
                    "background-color": "#ffffff",
                    "loading-style": "light",
                    style: { position: "relative", width: "100%", height: "100%" },
                    "data-testid": "needle-engine-view",
                })}
            </div>

            <Modal size="lg" show={openModal === NeedleEngineModal.CUSTOM_EVENT} onHide={() => setOpenModal(NeedleEngineModal.NONE)}>
                <Container style={{ padding: 16 }}>
                    <h3>Send Custom Event</h3>
                    <SendCustomEventPanel graph={getExecutableGraph()}/>
                    <hr style={{ borderTop: "1px solid #777", margin: "16px 0" }}/>
                    <Button variant="outline-secondary" style={{ width: "100%" }} onClick={() => setOpenModal(NeedleEngineModal.NONE)}>Close</Button>
                </Container>
            </Modal>
        </div>
    );
};
