import "needle-engine-runtime";
import { GameObject, getComponent, OrbitControls, WebXR } from "needle-engine-runtime";
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
import { trackEvent } from "../../utils/analytics";
import { getInteractivityRuntime, type InteractivityRuntime } from "../../integrations/InteractivityRuntime";
import { configureNeedleXR, type NeedleXRContext } from "../../integrations/NeedleXR";
import { IconPlay, IconSendEvent } from "../toolbarIcons";
import { useFullscreen } from "../../hooks/useFullscreen";
import { useModelFileDrop } from "../../hooks/useModelFileDrop";
import { ViewportControls } from "./ViewportControls";
import { downloadInteractiveModel, ModelExportFormat, ModelSource } from "./modelExport";
import { findModelEntry, ModelFileEntry } from "./modelFiles";
import { useModelSourceUrl } from "./modelSourceUrl";
import { ModelDropOverlay, ModelFileControls } from "./ModelFileControls";
import { MODEL_VIEW_Z_DIRECTION } from "./cameraFraming";
import { loadSelectedModelGraph } from "./modelGraphExecution";
import type { NeedleContext } from "../../integrations/NeedlePointerEvents";
import type { ThreeLoadedModel } from "./threeLoadedModel";

registerNeedleInteractivity({
    autoStart: false,
    initializeWithoutExtension: true,
});

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
    context?: NeedleMenuContext;
}

type NeedleMenuContext = NeedleContext & NeedleXRContext;

enum NeedleEngineModal {
    CUSTOM_EVENT = "CUSTOM_EVENT",
    NONE = "NONE",
}

interface NeedleEngineComponentProps {
    modelUrl?: string | null;
}

function configureNeedleView(context: NeedleMenuContext): void {
    configureNeedleXR(context, (scene, options) => {
        GameObject.addComponent(scene, WebXR, options);
    });
}

function frameNeedleModel(context: NeedleMenuContext, objects: unknown): void {
    const controls = getComponent(context.mainCamera, OrbitControls);
    if (!controls) {
        console.warn("Needle OrbitControls are not available for camera framing");
        return;
    }
    controls.fitCamera({
        objects,
        fitOffset: 1.2,
        fitDirection: { x: 0, y: 0.35, z: MODEL_VIEW_Z_DIRECTION },
        cameraNearFar: "auto",
        immediate: true,
    });
}

export const NeedleEngineComponent: React.FC<NeedleEngineComponentProps> = ({ modelUrl }) => {
    const engineElementRef = useRef<NeedleEngineElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const sourceRef = useRef<ModelSource | null>(null);
    const pendingLoadRef = useRef<PendingLoad | null>(null);
    const loadedModelRef = useRef<ThreeLoadedModel | null>(null);
    const runtimeRef = useRef<InteractivityRuntime | null>(null);
    const sourceUrl = useModelSourceUrl();
    const loadTokenRef = useRef(0);
    const [modelName, setModelName] = useState<string | null>(null);
    const [graphRunning, setGraphRunning] = useState(false);
    const [openModal, setOpenModal] = useState(NeedleEngineModal.NONE);
    const viewportFullscreen = useFullscreen(viewportRef);

    const {
        clearGraphDirty,
        getExecutableGraph,
        loadGraphFromJson,
        registerPlayHandler,
        setDiagnosticsForCategory,
        setGltfObjectModel,
        setSupportedPointerTemplates,
    } = useContext(InteractivityGraphContext);

    const loadSource = async (
        source: ModelSource,
        authoredGraph: IInteractivityGraph,
        replaceAuthoringGraph: boolean,
    ): Promise<void> => {
        const element = engineElementRef.current;
        if (!element) return;

        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        loadedModelRef.current = null;
        setGraphRunning(false);

        const token = ++loadTokenRef.current;
        pendingLoadRef.current = { authoredGraph, replaceAuthoringGraph, token };
        sourceRef.current = source;
        setModelName(source.kind === "files" ? source.model.file.name : source.url.split("/").pop() ?? "model.glb");

        let url: string;
        try {
            url = await sourceUrl(source);
        } catch (error) {
            console.error("Error loading model in Needle engine", error);
            return;
        }
        if (loadTokenRef.current !== token) return;

        element.removeAttribute("src");
        requestAnimationFrame(() => {
            if (loadTokenRef.current === token) element.setAttribute("src", url);
        });
    };

    const handleLoadedModel = async (context: NeedleMenuContext, loadedFiles: NeedleLoadedModel[]): Promise<void> => {
        configureNeedleView(context);
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
        frameNeedleModel(context, (file as unknown as { scene: unknown }).scene);
        setGraphRunning(true);
        clearGraphDirty();
    };

    const play = (): void => {
        trackEvent('scene_play', { engine: 'needle' });
        if (sourceRef.current) void loadSource(sourceRef.current, getExecutableGraph(), false);
    };
    const playRef = useRef(play);
    playRef.current = play;

    const frameModel = (): void => {
        const context = engineElementRef.current?.context;
        const model = loadedModelRef.current;
        if (context && model) {
            frameNeedleModel(context, model.scene);
        }
    };

    // a .glb, or a .gltf with its .bin/textures among the other files (selected or dropped)
    const selectModelFiles = (entries: ModelFileEntry[]): void => {
        const model = findModelEntry(entries);
        if (model === undefined) {
            console.warn("No .glb or .gltf among the selected files", entries.map((entry) => entry.path));
            return;
        }
        void loadSource({ kind: "files", model, entries }, getExecutableGraph(), true);
    };
    const draggingFiles = useModelFileDrop(selectModelFiles);

    // whichever model the viewport shows gets the graph embedded — samples loaded by URL included,
    // not only local uploads (see ModelSource)
    const exportModel = async (format: ModelExportFormat): Promise<void> => {
        const source = sourceRef.current;
        if (source === null) {
            console.warn("No model loaded to export");
            return;
        }
        try {
            trackEvent('graph_exported', { engine: 'needle' });
            await downloadInteractiveModel(source, getExecutableGraph(), format);
        } catch (error) {
            console.error("Failed to export model:", error);
            window.alert(`Export failed: ${error instanceof Error ? error.message : error}`);
        }
    };

    useEffect(() => {
        const element = engineElementRef.current;
        if (!element) return;
        const onLoadFinished = (event: Event): void => {
            const detail = (event as CustomEvent<{ context: NeedleMenuContext; loadedFiles: NeedleLoadedModel[] }>).detail;
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
            void loadSource({ kind: "url", url: modelUrl }, getExecutableGraph(), true);
        }
    }, [modelUrl]);

    useEffect(() => () => {
        loadTokenRef.current += 1;
        runtimeRef.current?.dispose();
        setSupportedPointerTemplates(null);
    }, []);

    return (
        <div className={"panel"}>
            <div className={"panel__toolbar"}>
                <button type="button" className="panel__toolbar-btn" onClick={play} disabled={!modelName}>
                    <IconPlay/>
                    Play
                </button>

                <button type="button" className="panel__toolbar-btn" onClick={() => setOpenModal(NeedleEngineModal.CUSTOM_EVENT)} disabled={!graphRunning}>
                    <IconSendEvent/>
                    Send Custom Event
                </button>

                <ModelFileControls
                    hasModel={!!modelName}
                    inputTestId={"needle-engine-file-input"}
                    downloadTestId={"needle-download-toggle"}
                    onSelectFiles={selectModelFiles}
                    onExport={(format) => void exportModel(format)}
                />

            </div>

            <ModelDropOverlay visible={draggingFiles}/>

            {/* the needle-engine element manages its own canvas, so this pane only has to be a
                sized, clipped box inside the panel body */}
            <div
                ref={viewportRef}
                className={`panel__body viewport-pane${viewportFullscreen.fallback ? " viewport-pane--fullscreen-fallback" : ""}`}
            >
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
                <ViewportControls
                    onFitView={frameModel}
                    fitDisabled={!modelName}
                    fitTestId={"needle-frame-btn"}
                    isFullscreen={viewportFullscreen.isFullscreen}
                    onToggleFullscreen={() => void viewportFullscreen.toggle()}
                    fullscreenTestId={"needle-fullscreen-btn"}
                />
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
