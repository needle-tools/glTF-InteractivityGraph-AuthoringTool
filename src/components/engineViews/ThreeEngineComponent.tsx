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
import { BasicBehaveEngine } from "../../BasicBehaveEngine/BasicBehaveEngine";
import { DOMEventBus } from "../../BasicBehaveEngine/eventBuses/DOMEventBus";
import { InteractivityGraphContext } from "../../InteractivityGraphContext";
import { buildGltfObjectModel } from "../../authoring/gltfObjectModel";
import { attachPointerEventLogging, SendCustomEventPanel } from "../../authoring/CustomEventControls";
import { buildNormalizedTemplateSet } from "../../authoring/pointerCatalogue";
import { computeExtensionDiagnostics } from "../../diagnostics";
import { ThreeDecorator } from "../../decorators/ThreeDecorator";
import { Spacer } from "../Spacer";
import { loadSelectedModelGraph } from "./modelGraphExecution";
import { createThreeLoader, disposeThreeLoadedModel, loadThreeModelFromUrl, ThreeLoadedModel } from "./threeLoadedModel";
import { downloadInteractivityGlb } from "./glbExport";

type ModelSource = { kind: "url"; url: string } | { kind: "file"; file: File };

enum ThreeEngineModal {
    CUSTOM_EVENT = "CUSTOM_EVENT",
    NONE = "NONE",
}

interface ThreeEngineComponentProps {
    modelUrl?: string | null;
}

export const ThreeEngineComponent: React.FC<ThreeEngineComponentProps> = ({ modelUrl }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const loaderRef = useRef<ReturnType<typeof createThreeLoader> | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const loadedModelRef = useRef<ThreeLoadedModel | null>(null);
    const decoratorRef = useRef<ThreeDecorator | null>(null);
    const sourceRef = useRef<ModelSource | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const loadTokenRef = useRef(0);
    const [modelName, setModelName] = useState<string | null>(null);
    const [graphRunning, setGraphRunning] = useState(false);
    const [openModal, setOpenModal] = useState(ThreeEngineModal.NONE);

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
        decoratorRef.current?.dispose();
        decoratorRef.current = null;
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
        cameraRef.current.position.set(center.x, center.y + maxDimension * 0.4, center.z + distance);
        cameraRef.current.near = Math.max(distance / 1000, 0.001);
        cameraRef.current.far = Math.max(distance * 100, 1000);
        cameraRef.current.updateProjectionMatrix();
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
    };

    const loadSource = async (
        source: ModelSource,
        authoredGraph: IInteractivityGraph,
        replaceAuthoringGraph: boolean,
    ): Promise<void> => {
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const canvas = canvasRef.current;
        if (!scene || !camera || !canvas) {
            return;
        }

        const loadToken = ++loadTokenRef.current;
        setGraphRunning(false);
        disposeLoadedModel();

        let objectUrl: string | undefined;
        try {
            const url = source.kind === "url" ? source.url : (objectUrl = URL.createObjectURL(source.file));
            const model = await loadThreeModelFromUrl(url, loaderRef.current ?? createThreeLoader());
            if (loadToken !== loadTokenRef.current) {
                disposeThreeLoadedModel(model);
                return;
            }

            loadedModelRef.current = model;
            scene.add(model.scene);
            frameModel(model);
            sourceRef.current = source;
            setModelName(source.kind === "file" ? source.file.name : source.url.split("/").pop() ?? "model.glb");

            setDiagnosticsForCategory(
                "extension",
                computeExtensionDiagnostics(model.gltf.extensionsUsed, model.gltf.extensionsRequired),
            );
            setGltfObjectModel(buildGltfObjectModel(model.gltf));

            const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
            decorator.setCamera(camera);
            decorator.attachPointerEvents(canvas);
            attachPointerEventLogging(decorator);
            decoratorRef.current = decorator;
            setSupportedPointerTemplates(buildNormalizedTemplateSet(decorator.getRegisteredJsonPointers()));

            const interactivity = model.gltf.extensions?.KHR_interactivity;
            const embeddedGraph = interactivity?.graphs?.[interactivity.graph ?? 0];
            await loadSelectedModelGraph({
                authoredGraph,
                embeddedGraph,
                replaceAuthoringGraph,
                loadGraphFromJson,
                loadBehaveGraph: (graph) => decorator.loadBehaveGraph(graph),
            });
            setGraphRunning(true);
            clearGraphDirty();
        } catch (error) {
            console.error("Error loading model in Three engine", error);
        } finally {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
    };

    const play = (): void => {
        if (sourceRef.current) {
            void loadSource(sourceRef.current, getExecutableGraph(), false);
        }
    };

    const downloadGlb = (): void => {
        const source = sourceRef.current;
        if (source?.kind === "file") {
            void downloadInteractivityGlb(source.file, getExecutableGraph());
        }
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        rendererRef.current = renderer;
        loaderRef.current = createThreeLoader(renderer);

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
            loaderRef.current = null;
            setSupportedPointerTemplates(null);
        };
    }, []);

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
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ background: "#3d5987", padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                <Button variant="outline-light" onClick={play} disabled={!modelName}>Play</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={() => setOpenModal(ThreeEngineModal.CUSTOM_EVENT)} disabled={!graphRunning}>Send Custom Event</Button>
                <Spacer width={16} height={0}/>
                <input
                    className="d-none"
                    type="file"
                    accept=".glb"
                    ref={fileInputRef}
                    data-testid="three-engine-file-input"
                    onChange={() => {
                        const file = fileInputRef.current?.files?.[0];
                        if (file) {
                            const source: ModelSource = { kind: "file", file };
                            sourceRef.current = source;
                            void loadSource(source, getExecutableGraph(), true);
                        }
                    }}
                />
                <Button variant="outline-light" onClick={() => fileInputRef.current?.click()}>Upload glb</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={downloadGlb} disabled={sourceRef.current?.kind !== "file"}>Download glb</Button>
                <Spacer width={16} height={0}/>
                <Button variant="outline-light" onClick={() => frameModel()} disabled={!modelName}>Auto Frame</Button>
            </div>

            <canvas ref={canvasRef} style={{ width: "100%", flex: 1, minHeight: 0 }} data-testid="three-engine-canvas"/>

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
