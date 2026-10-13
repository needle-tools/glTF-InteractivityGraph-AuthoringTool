import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    getInteractivityRuntime,
    InteractivityRuntime,
    registerGLTFInteractivity,
} from "three-gltf-interactivity";
const config = window.__GLTF_INTERACTIVITY_MATRIX_CONFIG__;
const manifest = await (await fetch(config.assetManifestUrl)).json();
const needleMode = !!config.runtimeShape;
let engine, context, unregister;
if (needleMode) {
    const needle = await import("@needle-tools/engine");
    const integration = await import("three-gltf-interactivity/needle");
    unregister = integration.registerNeedleInteractivity({ autoStart: false });
    engine = document.createElement("needle-engine");
    engine.setAttribute("camera-controls", "false");
    engine.style.cssText = "width:256px;height:256px;display:block";
    document.body.append(engine);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("Needle initialization timeout")),
            60000,
        );
        engine.addEventListener(
            "loadfinished",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
        engine.setAttribute("src", config.fixtureUrl);
    });
    context = engine.context;
    window.__CONFORMANCE_LOAD__ = async (url) =>
        needle.loadSync(context, url, url, 0);
} else {
    const loader = new GLTFLoader();
    registerGLTFInteractivity(loader, { autoStart: false });
    window.__CONFORMANCE_LOAD__ = (url) => loader.loadAsync(url);
}
const canvas = needleMode
    ? context.renderer.domElement
    : document.querySelector("canvas");
canvas.style.cssText = "width:256px;height:256px;display:block";
const camera = needleMode
    ? context.mainCamera
    : new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
const results = [];
window.__CONFORMANCE_PROGRESS__ = results;
window.__CONFORMANCE_READY__ = true;
window.__RUN_ASSET__ = async (asset, kind = "valid") => {
    const loaded = [];
    const executedOperations = new Set();
    const onErrors = [];
    const onError = (e) => onErrors.push(e.message);
    window.addEventListener("error", onError);
    const start = performance.now();
    try {
        if (kind === "invalid") {
            let error, file;
            const diagnostics = [];
            const methods = ["warn", "error"].map((method) => [
                method,
                console[method],
            ]);
            for (const [method, original] of methods)
                console[method] = (...args) => {
                    diagnostics.push(args.map(String).join(" "));
                    original.apply(console, args);
                };
            try {
                file = await window.__CONFORMANCE_LOAD__(asset.url);
                if (file) loaded.push(file);
            } catch (e) {
                error = e;
            } finally {
                for (const [method, original] of methods)
                    console[method] = original;
            }
            // Needle's loadSync catches loader rejection and returns undefined; Three rejects its Promise.
            const reason = String(error ?? diagnostics.join("\n"));
            if (file || !/Invalid KHR_interactivity/.test(reason))
                throw new Error(
                    `Expected graph rejection, received ${file ? "a loaded model" : reason || "no diagnostic"}`,
                );
            return { name: asset.id, status: "passed", rejected: true };
        }
        const entries = Array.isArray(asset) ? asset : [asset];
        for (const entry of entries) {
            const file = await window.__CONFORMANCE_LOAD__(entry.url);
            if (!file) throw new Error("Loader returned no model");
            loaded.push(file);
            const runtime = getInteractivityRuntime(file);
            if (!runtime) throw new Error("No interactivity runtime");
            if (!(runtime instanceof InteractivityRuntime))
                throw new Error(
                    "Expected InteractivityRuntime",
                );
            const onNode = runtime.engine.processNodeStarted;
            runtime.engine.processNodeStarted = (node) => {
                executedOperations.add(node.declaration?.op);
                onNode(node);
            };
            if (needleMode) context.scene.add(file.scene);
            runtime.setCamera(camera);
            if (!needleMode) runtime.attachPointerEvents(canvas);
        }
        let finished = 0,
            failed = false,
            expectedSeconds;
        const listen = (id) => (e) => {
            if (id === "onStart") {
                const value = e.detail?.expectedDuration;
                const n = Number(Array.isArray(value) ? value[0] : value);
                if (Number.isFinite(n))
                    expectedSeconds = Math.max(expectedSeconds ?? 0, n);
            } else {
                finished++;
                failed ||= id === "onFailed";
            }
        };
        const listeners = ["onStart", "onSuccess", "onFailed"].map((id) => [
            id,
            listen(id),
        ]);
        for (const [id, listener] of listeners)
            document.addEventListener(`KHR_INTERACTIVITY:test/${id}`, listener);
        try {
            for (const file of loaded) {
                const runtime = getInteractivityRuntime(file);
                runtime.decorator.loadBehaveGraph(runtime.graph, false);
            }
            for (const file of loaded)
                getInteractivityRuntime(file).decorator.playEventQueue();
            await delay(100);
            for (let i = 0; i < entries.length; i++) {
                const runtime = getInteractivityRuntime(loaded[i]);
                for (const interaction of entries[i].metadata?.tests.flatMap(
                    (test) => test.requiredInteractions ?? [],
                ) ?? []) {
                    const object =
                        runtime.model.nodes[interaction.targetNodeId];
                    const center = new THREE.Box3()
                        .setFromObject(object)
                        .getCenter(new THREE.Vector3());
                    camera.position
                        .copy(center)
                        .add(new THREE.Vector3(0, 0, 3));
                    camera.lookAt(center);
                    camera.updateProjectionMatrix();
                    camera.updateMatrixWorld(true);
                    runtime.model.scene.updateMatrixWorld(true);
                    const rect = canvas.getBoundingClientRect();
                    // Playwright drives a real mouse gesture; the browser suite only supplies the target.
                    const sequence = (window.__GESTURE_SEQUENCE__ ?? 0) + 1;
                    window.__GESTURE_SEQUENCE__ = sequence;
                    window.__PENDING_GESTURE__ = {
                        sequence,
                        type: interaction.type,
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,
                        leaveX: rect.right + 8,
                        leaveY: rect.top + rect.height / 2,
                    };
                    await new Promise((resolve) => {
                        window.__COMPLETE_GESTURE__ = (id) => {
                            if (id === sequence) {
                                window.__PENDING_GESTURE__ = null;
                                resolve();
                            }
                        };
                    });
                    await delay(100);
                }
            }
            let fallback = entries.every((entry) => !entry.metadata)
                ? 0.02
                : 0.5;
            for (const file of loaded)
                for (const node of getInteractivityRuntime(file).graph.nodes ??
                    []) {
                    const seconds = Number(node.values?.duration?.value?.[0]);
                    if (Number.isFinite(seconds))
                        fallback = Math.min(
                            7,
                            Math.max(fallback, seconds + 0.35),
                        );
                }
            while (
                finished < loaded.length &&
                performance.now() - start <
                    (expectedSeconds === undefined
                        ? fallback * 1000
                        : (expectedSeconds * 1.5 + 2) * 1000)
            )
                await delay(16);
            if (expectedSeconds !== undefined && finished < loaded.length)
                throw new Error(
                    `Missing completion event after ${expectedSeconds}s`,
                );
            let count = 0;
            const failures = [];
            for (let i = 0; i < loaded.length; i++) {
                const runtime = getInteractivityRuntime(loaded[i]);
                runtime.decorator.pauseEventQueue();
                for (const test of entries[i].metadata?.tests ?? [])
                    for (const subTest of test.subTests) {
                        count++;
                        if (
                            runtime.engine.variables[subTest.successResultVarId]
                                ?.value?.[0] !== true
                        )
                            failures.push(
                                `${test.name}/${subTest.name}: result=${JSON.stringify(runtime.engine.variables[subTest.resultVarId]?.value)} success=${JSON.stringify(runtime.engine.variables[subTest.successResultVarId]?.value)}`,
                            );
                    }
            }
            if (failed || failures.length || onErrors.length)
                throw new Error(
                    [
                        ...failures,
                        ...onErrors,
                        failed ? "test/onFailed emitted" : "",
                    ]
                        .filter(Boolean)
                        .join("\n"),
                );
            return {
                name: entries.map((a) => a.name).join("+"),
                status: "passed",
                assertionCount: count,
                elapsedMs: performance.now() - start,
                executedOperations: [...executedOperations]
                    .filter(Boolean)
                    .sort(),
            };
        } finally {
            for (const [id, listener] of listeners)
                document.removeEventListener(
                    `KHR_INTERACTIVITY:test/${id}`,
                    listener,
                );
        }
    } catch (error) {
        return {
            name:
                asset.name ?? asset.id ?? asset.map?.((a) => a.name).join("+"),
            status: "failed",
            error: error.stack ?? String(error),
        };
    } finally {
        window.removeEventListener("error", onError);
        for (const file of loaded) {
            if (!file) continue;
            getInteractivityRuntime(file)?.dispose();
            file.scene.removeFromParent();
            const textures = new Set();
            file.scene.traverse((object) => {
                object.geometry?.dispose();
                for (const material of Array.isArray(object.material)
                    ? object.material
                    : object.material
                      ? [object.material]
                      : []) {
                    for (const value of Object.values(material))
                        if (value?.isTexture) textures.add(value);
                    material.dispose();
                }
            });
            textures.forEach((texture) => texture.dispose());
        }
    }
};
window.__CONFORMANCE_MANIFEST__ = manifest;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
