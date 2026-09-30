import React, { useContext, useEffect, useRef, useState } from "react";
import { Button, Container, Modal } from "react-bootstrap";
import {
    AmbientLight,
    Box3,
    Color,
    DirectionalLight,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IInteractivityGraph } from "../../BasicBehaveEngine/types/InteractivityGraph";
import { InteractivityGraphContext } from "../../InteractivityGraphContext";
import { buildGltfObjectModel } from "../../authoring/gltfObjectModel";
import { attachPointerEventLogging, SendCustomEventPanel } from "../../authoring/CustomEventControls";
import { buildNormalizedTemplateSet } from "../../authoring/pointerCatalogue";
import { computeExecutionDiagnostics, computeExtensionDiagnostics } from "../../diagnostics";
import { registerGLTFInteractivity } from "../../integrations/GLTFInteractivityPlugin";
import { trackEvent } from "../../utils/analytics";
import { getInteractivityRuntime, type InteractivityRuntime } from "../../integrations/InteractivityRuntime";
import { useDevicePixelRatio } from "../../hooks/useDevicePixelRatio";
import { useFullscreen } from "../../hooks/useFullscreen";
import { IconPlay, IconSendEvent, IconUpload } from "../toolbarIcons";
import { ViewportControls } from "./ViewportControls";
import { loadSelectedModelGraph } from "./modelGraphExecution";
import { createThreeLoader, disposeThreeLoadedModel, ThreeLoadedModel } from "./threeLoadedModel";
import { downloadInteractiveModel, ModelExportFormat, ModelSource } from "./modelExport";
import { createModelFileUrls, entriesFromFileList, findModelEntry, ModelFileEntry, ModelFileUrls } from "./modelFiles";
import { MODEL_UPLOAD_ACCEPT, MODEL_UPLOAD_TITLE, ModelDownloadMenu, ModelDropOverlay, useModelFileDrop } from "./modelFileUi";
import { configureThreeModelNavigation, MODEL_VIEW_Z_DIRECTION } from "./cameraFraming";

/** upper bound for the device-pixel render scale, as in the Babylon view */
const MAX_RENDER_SCALE = 2;

enum ThreeEngineModal {
    CUSTOM_EVENT = "CUSTOM_EVENT",
    NONE = "NONE",
}

interface ThreeEngineComponentProps {
    modelUrl?: string | null;
}

export const ThreeEngineComponent: React.FC<ThreeEngineComponentProps> = ({ modelUrl }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const loaderRef = useRef<ReturnType<typeof createThreeLoader> | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const loadedModelRef = useRef<ThreeLoadedModel | null>(null);
    const runtimeRef = useRef<InteractivityRuntime | null>(null);
    const sourceRef = useRef<ModelSource | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const loadTokenRef = useRef(0);
    const [modelName, setModelName] = useState<string | null>(null);
    const [graphRunning, setGraphRunning] = useState(false);
    const [openModal, setOpenModal] = useState(ThreeEngineModal.NONE);
    const devicePixelRatio = useDevicePixelRatio();
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

    const disposeLoadedModel = (): void => {
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        if (loadedModelRef.current) {
            sceneRef.current?.remove(loadedModelRef.current.scene);
            disposeThreeLoadedModel(loadedModelRef.current);
            loadedModelRef.current = null;
        }
    };

    const frameModel = (model = loadedModelRef.current): void => {
        if (!model || !cameraRef.current || !controlsRef.current) {
            return;
        }
        const box = new Box3().setFromObject(model.scene);
        if (box.isEmpty()) {
            return;
        }
        const center = box.getCenter(new Vector3());
        const size = box.getSize(new Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
        const distance = (maxDimension / Math.tan(cameraRef.current.fov * Math.PI / 360)) * 0.75;
        cameraRef.current.position.set(
            center.x,
            center.y + maxDimension * 0.4,
            center.z + distance * MODEL_VIEW_Z_DIRECTION,
        );
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
        configureThreeModelNavigation(cameraRef.current, controlsRef.current, maxDimension);
    };

    const loadSource = async (
        source: ModelSource,
        authoredGraph: IInteractivityGraph,
        replaceAuthoringGraph: boolean,
    ): Promise<void> => {
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const canvas = canvasRef.current;
        const loader = loaderRef.current;
        if (!scene || !camera || !canvas || !loader) {
            return;
        }

        const loadToken = ++loadTokenRef.current;
        setGraphRunning(false);
        disposeLoadedModel();

        // a .gltf from local files resolves its .bin/textures among the other selected files
        let fileUrls: ModelFileUrls | undefined;
        try {
            let url: string;
            if (source.kind === "url") {
                url = source.url;
            } else {
                fileUrls = createModelFileUrls(source.entries, source.model);
                loader.manager.setURLModifier(fileUrls.resolve);
                url = fileUrls.modelUrl;
            }
            const gltf = await loader.loadAsync(url);
            const runtime = getInteractivityRuntime(gltf);
            if (!runtime) throw new Error("GLTFInteractivityPlugin did not attach a runtime");
            const model = runtime.model;
            if (loadToken !== loadTokenRef.current) {
                runtime.dispose();
                disposeThreeLoadedModel(model);
                return;
            }

            loadedModelRef.current = model;
            scene.add(model.scene);
            frameModel(model);
            sourceRef.current = source;
            setModelName(source.kind === "files" ? source.model.file.name : source.url.split("/").pop() ?? "model.glb");

            setDiagnosticsForCategory(
                "extension",
                computeExtensionDiagnostics(model.gltf.extensionsUsed, model.gltf.extensionsRequired),
            );
            setGltfObjectModel(buildGltfObjectModel(model.gltf));

            const decorator = runtime.decorator;
            // a rejected graph or a runtime error that halts the engine shows up in the diagnostics panel
            setDiagnosticsForCategory("execution", []);
            decorator.setExecutionErrorListener((error) => {
                console.warn("KHR_interactivity graph execution stopped", error);
                setDiagnosticsForCategory("execution", computeExecutionDiagnostics(error));
            });
            decorator.setCamera(camera);
            decorator.attachPointerEvents(canvas);
            attachPointerEventLogging(decorator);
            runtimeRef.current = runtime;
            setSupportedPointerTemplates(buildNormalizedTemplateSet(decorator.getRegisteredJsonPointers()));

            const interactivity = model.gltf.extensions?.KHR_interactivity;
            const embeddedGraph = interactivity?.graphs?.[interactivity.graph ?? 0];
            await loadSelectedModelGraph({
                authoredGraph,
                embeddedGraph,
                replaceAuthoringGraph,
                loadGraphFromJson,
                loadBehaveGraph: (graph) => {
                    try {
                        decorator.loadBehaveGraph(graph);
                    } catch (error) {
                        setDiagnosticsForCategory("execution", computeExecutionDiagnostics(error));
                        throw error;
                    }
                },
            });
            setGraphRunning(true);
            clearGraphDirty();
        } catch (error) {
            console.error("Error loading model in Three engine", error);
        } finally {
            if (fileUrls) {
                loader.manager.setURLModifier(undefined);
                fileUrls.dispose();
            }
        }
    };

    const selectModelFiles = (entries: ModelFileEntry[]): void => {
        const model = findModelEntry(entries);
        if (model === undefined) {
            console.warn("No .glb or .gltf among the selected files", entries.map((entry) => entry.path));
            return;
        }
        const source: ModelSource = { kind: "files", model, entries };
        sourceRef.current = source;
        void loadSource(source, getExecutableGraph(), true);
    };
    const draggingFiles = useModelFileDrop(selectModelFiles);

    const play = (): void => {
        trackEvent('scene_play', { engine: 'three' });
        if (sourceRef.current) {
            void loadSource(sourceRef.current, getExecutableGraph(), false);
        }
    };

    // whichever model the viewport shows gets the graph embedded — samples loaded by URL included,
    // not only local uploads (see ModelSource)
    const exportModel = (format: ModelExportFormat): void => {
        const source = sourceRef.current;
        if (source === null) {
            console.warn("No model loaded to export");
            return;
        }
        trackEvent('graph_exported', { engine: 'three', format });
        void downloadInteractiveModel(source, getExecutableGraph(), format).catch((error) => {
            console.error("Failed to export model:", error);
            window.alert(`Export failed: ${error instanceof Error ? error.message : error}`);
        });
    };
    const playRef = useRef(play);
    playRef.current = play;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.outputColorSpace = SRGBColorSpace;
        rendererRef.current = renderer;
        const loader = createThreeLoader(renderer);
        const unregisterInteractivity = registerGLTFInteractivity(loader, {
            autoStart: false,
            initializeWithoutExtension: true,
        });
        loaderRef.current = loader;

        const scene = new Scene();
        scene.background = new Color(0xffffff);
        scene.add(new AmbientLight(0xffffff, 1.5));
        const keyLight = new DirectionalLight(0xffffff, 2.5);
        keyLight.position.set(3, 5, 4);
        scene.add(keyLight);
        sceneRef.current = scene;

        const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
        camera.position.set(0, 1, 4);
        cameraRef.current = camera;
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controlsRef.current = controls;

        const resize = (): void => {
            const width = Math.max(1, canvas.clientWidth);
            const height = Math.max(1, canvas.clientHeight);
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();

        const render = (): void => {
            controls.update();
            renderer.render(scene, camera);
            animationFrameRef.current = requestAnimationFrame(render);
        };
        render();

        const blockWheelPropagation = (event: WheelEvent): void => event.stopPropagation();
        canvas.addEventListener("wheel", blockWheelPropagation);

        return () => {
            loadTokenRef.current += 1;
            canvas.removeEventListener("wheel", blockWheelPropagation);
            resizeObserver.disconnect();
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            disposeLoadedModel();
            controls.dispose();
            renderer.dispose();
            unregisterInteractivity();
            loaderRef.current = null;
            setSupportedPointerTemplates(null);
        };
    }, []);

    // follow the display's pixel ratio (capped) so the viewport stays sharp when the window moves
    // to a monitor with a different scale factor
    useEffect(() => {
        const renderer = rendererRef.current;
        const canvas = canvasRef.current;
        if (!renderer || !canvas) { return; }
        renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_RENDER_SCALE));
        renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false);
    }, [devicePixelRatio]);

    useEffect(() => {
        registerPlayHandler(() => playRef.current());
        return () => registerPlayHandler(null);
    }, []);

    useEffect(() => {
        if (modelUrl && rendererRef.current) {
            const source: ModelSource = { kind: "url", url: modelUrl };
            sourceRef.current = source;
            void loadSource(source, getExecutableGraph(), true);
        }
    }, [modelUrl]);

    return (
        <div className={"panel"}>
            <div className={"panel__toolbar"}>
                <button type="button" className="panel__toolbar-btn" onClick={play} disabled={!modelName}>
                    <IconPlay/>
                    Play
                </button>

                <button type="button" className="panel__toolbar-btn" onClick={() => setOpenModal(ThreeEngineModal.CUSTOM_EVENT)} disabled={!graphRunning}>
                    <IconSendEvent/>
                    Send Custom Event
                </button>

                <span className={"panel__toolbar-label"}>Model</span>
                <input
                    className="d-none"
                    type="file"
                    multiple
                    accept={MODEL_UPLOAD_ACCEPT}
                    ref={fileInputRef}
                    data-testid="three-engine-file-input"
                    onChange={(event) => {
                        selectModelFiles(entriesFromFileList(event.target.files));
                        // allow selecting the same file again
                        event.target.value = "";
                    }}
                />
                <button type="button" className="panel__toolbar-btn" onClick={() => fileInputRef.current?.click()} title={MODEL_UPLOAD_TITLE}>
                    <IconUpload/>
                    Upload glb/glTF
                </button>

                <ModelDownloadMenu disabled={!modelName} testId={"three-download-toggle"} onExport={exportModel}/>

            </div>

            <ModelDropOverlay visible={draggingFiles}/>

            <div
                ref={viewportRef}
                className={`panel__body viewport-pane${viewportFullscreen.fallback ? " viewport-pane--fullscreen-fallback" : ""}`}
            >
                <canvas ref={canvasRef} style={{ width: "100%", flex: 1, minHeight: 0 }} data-testid="three-engine-canvas"/>
                <ViewportControls
                    onFitView={() => frameModel()}
                    fitDisabled={!modelName}
                    fitTestId={"three-frame-btn"}
                    isFullscreen={viewportFullscreen.isFullscreen}
                    onToggleFullscreen={() => void viewportFullscreen.toggle()}
                    fullscreenTestId={"three-fullscreen-btn"}
                />
            </div>

            <Modal size="lg" show={openModal === ThreeEngineModal.CUSTOM_EVENT} onHide={() => setOpenModal(ThreeEngineModal.NONE)}>
                <Container style={{ padding: 16 }}>
                    <h3>Send Custom Event</h3>
                    <SendCustomEventPanel graph={getExecutableGraph()}/>
                    <hr style={{ borderTop: "1px solid #777", margin: "16px 0" }}/>
                    <Button variant="outline-secondary" style={{ width: "100%" }} onClick={() => setOpenModal(ThreeEngineModal.NONE)}>Close</Button>
                </Container>
            </Modal>
        </div>
    );
};
