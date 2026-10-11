import { XRDevice, metaQuest3 } from "iwer";
import * as THREE from "three";
import { SyntheticEnvironmentModule } from "@iwer/sem";
const device = new XRDevice(metaQuest3, { stereoEnabled: false });
device.installRuntime({ forceInstall: true });
// Explicitly connect inputs so IWER synchronizes its Gamepad.connected flags.
for (const input of [
    ...Object.values(device.controllers),
    ...Object.values(device.hands),
])
    input.connected = true;
device.installSEM(SyntheticEnvironmentModule);
await device.sem.loadDefaultEnvironment("living_room");
const needle = await import("@needle-tools/engine");
const { registerNeedleInteractivity, getInteractivityRuntime } =
    await import("three-gltf-interactivity/needle");
const config = window.__GLTF_INTERACTIVITY_MATRIX_CONFIG__;
const manifest = await (await fetch(config.assetManifestUrl)).json();
registerNeedleInteractivity({ autoStart: false });
const engine = document.createElement("needle-engine");
engine.setAttribute("camera-controls", "false");
engine.style.cssText = "width:512px;height:512px;display:block";
document.body.append(engine);
await new Promise((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error("Needle initialization timed out")),
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
const context = engine.context;
const webxr = needle.GameObject.addComponent(context.scene, needle.WebXR, {
    createVRButton: false,
    createARButton: false,
    useQuicklookExport: false,
    usePlacementReticle: true,
    usePlacementAdjustment: true,
    autoPlace: true,
});
await delay(200);
window.__XR_READY__ = true;
window.__XR_DEVICE__ = device;
window.__RUN_XR__ = async ({ mode, inputMode }) => {
    let session;
    const results = [];
    const files = [];
    try {
        device.primaryInputMode = inputMode;
        const assets = manifest.cases.filter((a) =>
            a.name.startsWith("UserInteractions/"),
        );
        const early = await needle.loadSync(
            context,
            assets[0].url,
            assets[0].url,
            0,
        );
        if (!early) throw new Error("Pre-XR model failed to load");
        files.push(early);
        context.scene.add(early.scene);
        session = await (mode === "immersive-vr"
            ? webxr.enterVR({
                  requiredFeatures: ["local-floor"],
                  optionalFeatures: [
                      "local",
                      "hand-tracking",
                      "hit-test",
                      "anchors",
                  ],
              })
            : webxr.enterAR({
                  requiredFeatures: ["local-floor"],
                  optionalFeatures: [
                      "local",
                      "hand-tracking",
                      "hit-test",
                      "anchors",
                  ],
              }));
        if (!session) throw new Error(`Needle rejected ${mode}`);
        await waitFor(() => context.renderer.xr.isPresenting, "XR presenting");
        await delay(200);
        const frameProbe = await Promise.race([
            new Promise((resolve) =>
                device.activeSession.requestAnimationFrame(() => resolve(true)),
            ),
            delay(1000).then(() => false),
        ]);
        if (!frameProbe) throw new Error("IWER did not deliver an XR frame");
        if (!context.xrCamera) throw new Error("Needle XR camera is missing");
        for (const [index, asset] of assets.entries()) {
            // Cover both existing models on session entry and late loaded models.
            const file =
                index === 0
                    ? early
                    : await needle.loadSync(context, asset.url, asset.url, 0);
            if (!file) throw new Error("XR model failed to load");
            if (index !== 0) {
                files.push(file);
                context.scene.add(file.scene);
            }
            const runtime = getInteractivityRuntime(file);
            if (!runtime) throw new Error("XR-loaded model has no runtime");
            const selections = [];
            const hovers = [];
            const hover = runtime.decorator.hoverOn;
            runtime.decorator.hoverOn = (...args) => {
                hovers.push(args);
                hover.apply(runtime.decorator, args);
            };
            const original = runtime.decorator.select;
            runtime.decorator.select = (...args) => {
                selections.push(args);
                original.apply(runtime.decorator, args);
            };
            runtime.start();
            await delay(150);
            const interactions = asset.metadata.tests.flatMap(
                (test) => test.requiredInteractions ?? [],
            );
            for (const hand of ["left", "right"]) {
                const input =
                    inputMode === "hand"
                        ? device.hands[hand]
                        : device.controllers[hand];
                const other =
                    inputMode === "hand"
                        ? device.hands[hand === "left" ? "right" : "left"]
                        : device.controllers[
                              hand === "left" ? "right" : "left"
                          ];
                other.position.set(20, 20, 20);
                for (const interaction of interactions) {
                    const target =
                        runtime.model.nodes[interaction.targetNodeId];
                    const center = new THREE.Box3()
                        .setFromObject(target)
                        .getCenter(new THREE.Vector3());
                    const controller = context.renderer.xr.getController(
                        hand === "left" ? 0 : 1,
                    );
                    controller.updateWorldMatrix(true, false);
                    // IWER poses are reference-space coordinates; remove Needle's rig transform.
                    const inverse = new THREE.Matrix4()
                        .copy(
                            context.mainCamera?.parent?.matrixWorld ??
                                new THREE.Matrix4(),
                        )
                        .invert();
                    const pose = center
                        .clone()
                        .add(new THREE.Vector3(0, 0, 2))
                        .applyMatrix4(inverse);
                    const direction = center
                        .clone()
                        .applyMatrix4(inverse)
                        .sub(pose)
                        .normalize();
                    const orientation =
                        new THREE.Quaternion().setFromUnitVectors(
                            new THREE.Vector3(0, 0, -1),
                            direction,
                        );
                    input.position.set(pose.x, pose.y, pose.z);
                    input.quaternion.set(
                        orientation.x,
                        orientation.y,
                        orientation.z,
                        orientation.w,
                    );
                    const hoverStart = hovers.length;
                    await delay(300);
                    if (
                        interaction.type === "hover" &&
                        interaction.expectation === "mustFire" &&
                        !hovers
                            .slice(hoverStart)
                            .some(
                                (args) => args[0] === interaction.targetNodeId,
                            )
                    ) {
                        throw new Error(
                            `XR hover missed ${hand}: ${JSON.stringify({ center: center.toArray(), pose: pose.toArray(), hovers: hovers.slice(-4), frame: context.time.frameCount, hasXRFrame: !!context.xrFrame, paused: context.isPaused, visible: context.isVisibleToUser, controllers: context.xr.controllers.map((c) => ({ index: c.index, connected: c.connected, tracking: c.isTracking, origin: c.ray.origin.toArray(), direction: c.ray.direction.toArray() })), presenting: context.renderer.xr.isPresenting })}`,
                        );
                    }
                    const before = selections.length;
                    if (interaction.type === "select") {
                        if (inputMode === "hand") input.updatePinchValue(1);
                        else input.updateButtonValue("trigger", 1);
                        await delay(150);
                        if (inputMode === "hand") input.updatePinchValue(0);
                        else input.updateButtonValue("trigger", 0);
                        await delay(150);
                        const newSelections = selections.slice(before);
                        if (interaction.expectation === "mustFire") {
                            if (newSelections.length !== 1)
                                throw new Error(
                                    `${hand}/${inputMode} ${interaction.targetNodeName}: expected one selection, received ${newSelections.length}`,
                                );
                            const [index, controllerIndex, point, origin] =
                                newSelections[0];
                            if (
                                index !== interaction.targetNodeId ||
                                controllerIndex < 0 ||
                                !point?.every(Number.isFinite) ||
                                !origin?.every(Number.isFinite)
                            )
                                throw new Error(
                                    `Invalid XR selection payload ${JSON.stringify(newSelections[0])}`,
                                );
                        } else if (newSelections.length)
                            throw new Error(
                                `Disabled target ${interaction.targetNodeName} selected`,
                            );
                    }
                    input.position.set(20, 20, 20);
                    await delay(200);
                }
            }
            const deadline = performance.now() + 26000;
            const subTests = asset.metadata.tests.flatMap(
                (test) => test.subTests,
            );
            while (
                subTests.some(
                    (sub) =>
                        runtime.engine.variables[sub.successResultVarId]
                            ?.value?.[0] !== true,
                ) &&
                performance.now() < deadline
            )
                await delay(50);
            const failures = subTests
                .filter(
                    (sub) =>
                        runtime.engine.variables[sub.successResultVarId]
                            ?.value?.[0] !== true,
                )
                .map((sub) => sub.name);
            if (failures.length)
                throw new Error(`${asset.name}: failed ${failures.join(", ")}`);
            const cameraPosition = runtime.decorator.getPathValue(
                "/extensions/KHR_interactivity/activeCamera/position",
            );
            const xrPosition = context.xrCamera
                .getWorldPosition(new THREE.Vector3())
                .toArray();
            if (
                !cameraPosition?.every(
                    (value, i) => Math.abs(value - xrPosition[i]) < 1e-5,
                )
            )
                throw new Error(
                    "Runtime active-camera pointer did not switch to the XR camera",
                );
            const fovy = runtime.decorator.getPathValue(
                "/extensions/KHR_interactivity/activeCamera/perspective/yfov",
            )?.[0];
            // Three's stereo union projection shifts the vertical angle slightly
            // when expanding the near plane to contain both eye frusta.
            if (!Number.isFinite(fovy) || Math.abs(fovy - device.fovy) > 1e-4)
                throw new Error(
                    `XR field of view is stale: ${fovy}, expected IWER ${device.fovy}`,
                );
            results.push({
                name: asset.name,
                assertionCount: subTests.length,
                loading: index === 0 ? "before XR" : "during XR",
                cameraFovy: fovy,
                selections: selections.map((args) => ({
                    nodeIndex: args[0],
                    controllerIndex: args[1],
                    point: args[2],
                    origin: args[3],
                })),
            });
            runtime.dispose();
            file.scene.removeFromParent();
        }
        return { status: "passed", mode, inputMode, results };
    } catch (error) {
        return {
            status: "failed",
            mode,
            inputMode,
            error: error.stack ?? String(error),
            results,
        };
    } finally {
        for (const file of files) {
            getInteractivityRuntime(file)?.dispose();
            file.scene.removeFromParent();
        }
        if (device.activeSession) await device.activeSession.end();
        await waitFor(() => !context.renderer.xr.isPresenting, "XR exit");
    }
};
async function waitFor(predicate, label) {
    const end = performance.now() + 10000;
    while (!predicate()) {
        if (performance.now() > end) throw new Error(`Timed out: ${label}`);
        await delay(20);
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
