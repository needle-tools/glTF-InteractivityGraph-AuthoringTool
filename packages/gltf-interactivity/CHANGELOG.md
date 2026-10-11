# Changelog

## 0.1.0

- Publish the integration as `three-gltf-interactivity`, with the Khronos runtime as a dependency and the Needle adapter at `three-gltf-interactivity/needle`.
- Initial `KHR_interactivity` runtime for Three.js and Needle Engine.
- Portable browser declarations and delay bounds/ownership cleanup in the Khronos core candidate.
- Use the Khronos engine as an external dependency; validate default graphs before loading.
- Correct animation stopAt completion for reverse playback, endpoints and stops outside the playback interval.
- Keep animation playback and graph timers on the same elapsed-time clock despite Needle’s capped frame delta.
- XR projection field-of-view/aspect pointers and stale-session event rejection.
- Exact geometry desktop selection and Needle XR controller/hand selection, hover and camera updates.
- Packed consumer builds, complete current asset corpus and IWER AR/VR matrix tests.
- Loader-native `KHR_animation_pointer` support through `@needle-tools/three-animation-pointer`.
- Pointer, animation, material, scene, and structural object-model bindings.
