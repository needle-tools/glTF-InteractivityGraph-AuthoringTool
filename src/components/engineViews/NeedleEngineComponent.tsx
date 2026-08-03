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
import { IconDownload, IconFrame, IconPlay, IconSendEvent, IconUpload } from "../toolbarIcons";
import { downloadInteractivityGlb, GlbSource } from "./glbExport";
import { MODEL_VIEW_Z_DIRECTION } from "./cameraFraming";
import { loadSelectedModelGraph } from "./modelGraphExecution";
import type { NeedleContext } from "../../integrations/NeedlePointerEvents";
import type { ThreeLoadedModel } from "./threeLoadedModel";

registerNeedleInteractivity({
    autoStart: false,
    initializeWithoutExtension: true,
});

/** what the viewport currently shows — the same shape the glb export takes as its source */
type ModelSource = GlbSource;

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
        if (sourceRef.current) loadSource(sourceRef.current, getExecutableGraph(), false);
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

    // whichever glb the viewport shows gets the graph embedded — samples loaded by URL included,
    // not only local uploads (see GlbSource)
    const downloadGlb = (): void => {
        const source = sourceRef.current;
        if (source === null) {
            console.warn("No model loaded to export");
            return;
        }
        trackEvent('graph_exported', { engine: 'needle' });
        void downloadInteractivityGlb(source, getExecutableGraph())
            .catch((error) => console.error("Failed to export glb:", error));
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

                <span className={"panel__toolbar-label"}>Model</span>
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
                <button type="button" className="panel__toolbar-btn" onClick={() => fileInputRef.current?.click()}>
                    <IconUpload/>
                    Upload glb
                </button>

                <button type="button" className="panel__toolbar-btn" onClick={downloadGlb} disabled={!modelName}>
                    <IconDownload/>
                    Download glb
                </button>

                <span className={"panel__toolbar-spacer"}/>

                <button type="button" data-testid={"needle-frame-btn"} className="panel__toolbar-btn" onClick={frameModel} disabled={!modelName}>
                    <IconFrame/>
                    Fit View
                </button>
            </div>

            {/* the needle-engine element manages its own canvas, so this pane only has to be a
                sized, clipped box inside the panel body */}
            <div className={"panel__body"} style={{ position: "relative", overflow: "hidden", background: "#fff" }}>
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
