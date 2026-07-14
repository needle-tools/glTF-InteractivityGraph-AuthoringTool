import {
    DoubleSide,
    Material,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    Texture,
} from "three";
import type { ThreeLoadedModel } from "../components/engineViews/threeLoadedModel";
import { glTFSchemaMetadata } from "../objectModel/generated/glTFSchemaMetadata";
import type { ThreePointerBinder } from "./threePointerTypes";

type ColorMaterial = MeshBasicMaterial | MeshStandardMaterial;

interface TextureBinding {
    path: string;
    select: (material: Material) => Texture | null;
}

interface MaterialPointerDefinition {
    template: string;
    extension?: string;
    requiredParentSegments?: readonly string[];
}

export function registerThreeMaterialPointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    model.materialInstances.forEach((instances, materialIndex) => {
        const sourceMaterial = model.gltf.materials?.[materialIndex] ?? {};
        const bindDefined = onlyDefinedMaterialPointers(model, materialIndex, bind);
        const colorMaterials = instances.filter(isColorMaterial);
        const standardMaterials = instances.filter(isStandardMaterial);
        const physicalMaterials = instances.filter(isPhysicalMaterial);

        bindScalar(bindDefined, `/materials/${materialIndex}/alphaCutoff`, instances, (material) => material.alphaTest, (material, value) => material.alphaTest = value);
        bindDefined(`/materials/${materialIndex}/doubleSided`, "bool", () => [instances[0]?.side === DoubleSide], undefined, true);

        if (colorMaterials.length > 0) {
            const first = colorMaterials[0];
            bindDefined(`/materials/${materialIndex}/pbrMetallicRoughness/baseColorFactor`, "float4", () => [
                first.color.r,
                first.color.g,
                first.color.b,
                first.opacity,
            ], (value) => {
                const next = asArray(value);
                colorMaterials.forEach((material) => {
                    material.color.setRGB(next[0], next[1], next[2]);
                    material.opacity = next[3];
                    material.transparent = next[3] < 1;
                    material.needsUpdate = true;
                });
            });
        }

        if (standardMaterials.length > 0) {
            bindColor(bindDefined, `/materials/${materialIndex}/emissiveFactor`, standardMaterials, (material) => material.emissive);
            bindScalar(bindDefined, `/materials/${materialIndex}/pbrMetallicRoughness/roughnessFactor`, standardMaterials, (material) => material.roughness, (material, value) => material.roughness = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/pbrMetallicRoughness/metallicFactor`, standardMaterials, (material) => material.metalness, (material, value) => material.metalness = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_emissive_strength/emissiveStrength`, standardMaterials, (material) => material.emissiveIntensity, (material, value) => material.emissiveIntensity = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/normalTexture/scale`, standardMaterials, (material) => Math.abs(material.normalScale.x), (material, value) => setNormalScale(material.normalScale, value));
            bindScalar(bindDefined, `/materials/${materialIndex}/occlusionTexture/strength`, standardMaterials, (material) => material.aoMapIntensity, (material, value) => material.aoMapIntensity = value);

        } else {
            bindStoredColor(bindDefined, `/materials/${materialIndex}/emissiveFactor`, sourceMaterial.emissiveFactor ?? [0, 0, 0]);
            bindStoredScalar(bindDefined, `/materials/${materialIndex}/pbrMetallicRoughness/roughnessFactor`, sourceMaterial.pbrMetallicRoughness?.roughnessFactor ?? 1);
            bindStoredScalar(bindDefined, `/materials/${materialIndex}/pbrMetallicRoughness/metallicFactor`, sourceMaterial.pbrMetallicRoughness?.metallicFactor ?? 1);
        }

        if (physicalMaterials.length > 0) {
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_anisotropy/anisotropyRotation`, physicalMaterials, (material) => material.anisotropyRotation ?? 0, (material, value) => material.anisotropyRotation = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_anisotropy/anisotropyStrength`, physicalMaterials, (material) => material.anisotropy, (material, value) => material.anisotropy = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_clearcoat/clearcoatFactor`, physicalMaterials, (material) => material.clearcoat, (material, value) => material.clearcoat = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_clearcoat/clearcoatRoughnessFactor`, physicalMaterials, (material) => material.clearcoatRoughness, (material, value) => material.clearcoatRoughness = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_clearcoat/clearcoatNormalTexture/scale`, physicalMaterials, (material) => Math.abs(material.clearcoatNormalScale.x), (material, value) => setNormalScale(material.clearcoatNormalScale, value));
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_dispersion/dispersion`, physicalMaterials, (material) => material.dispersion, (material, value) => material.dispersion = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_ior/ior`, physicalMaterials, (material) => material.ior, (material, value) => material.ior = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_iridescence/iridescenceFactor`, physicalMaterials, (material) => material.iridescence, (material, value) => material.iridescence = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_iridescence/iridescenceIor`, physicalMaterials, (material) => material.iridescenceIOR, (material, value) => material.iridescenceIOR = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_iridescence/iridescenceThicknessMinimum`, physicalMaterials, (material) => material.iridescenceThicknessRange[0], (material, value) => material.iridescenceThicknessRange[0] = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_iridescence/iridescenceThicknessMaximum`, physicalMaterials, (material) => material.iridescenceThicknessRange[1], (material, value) => material.iridescenceThicknessRange[1] = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_sheen/sheenRoughnessFactor`, physicalMaterials, (material) => material.sheenRoughness, (material, value) => material.sheenRoughness = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_specular/specularFactor`, physicalMaterials, (material) => material.specularIntensity, (material, value) => material.specularIntensity = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_transmission/transmissionFactor`, physicalMaterials, (material) => material.transmission, (material, value) => material.transmission = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_volume/attenuationDistance`, physicalMaterials, (material) => material.attenuationDistance, (material, value) => material.attenuationDistance = value);
            bindScalar(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_volume/thicknessFactor`, physicalMaterials, (material) => material.thickness, (material, value) => material.thickness = value);
            bindColor(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_sheen/sheenColorFactor`, physicalMaterials, (material) => material.sheenColor);
            bindColor(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_specular/specularColorFactor`, physicalMaterials, (material) => material.specularColor);
            bindColor(bindDefined, `/materials/${materialIndex}/extensions/KHR_materials_volume/attenuationColor`, physicalMaterials, (material) => material.attenuationColor);
        }

        for (const textureBinding of textureBindings(materialIndex)) {
            const sourcePath = textureBinding.path.split("/").slice(3);
            bindTexturePointers(bindDefined, textureBinding, instances, getPath(sourceMaterial, sourcePath) as any);
        }
    });
}

function onlyDefinedMaterialPointers(model: ThreeLoadedModel, materialIndex: number, bind: ThreePointerBinder): ThreePointerBinder {
    const material = model.gltf.materials?.[materialIndex] ?? {};
    const defined = new Set<string>();
    for (const definition of glTFSchemaMetadata.materialPointers as readonly MaterialPointerDefinition[]) {
        if (!definition.template.includes("{}") || definition.extension && material.extensions?.[definition.extension] === undefined) {
            continue;
        }
        if (definition.requiredParentSegments && getPath(material, definition.requiredParentSegments) === undefined) {
            continue;
        }
        defined.add(definition.template.replace("{}", String(materialIndex)));
    }
    for (const texture of textureBindings(materialIndex)) {
        const sourcePath = texture.path.split("/").slice(3);
        if (getPath(material, sourcePath) === undefined) {
            continue;
        }
        const transform = `${texture.path}/extensions/KHR_texture_transform`;
        defined.add(`${transform}/offset`);
        defined.add(`${transform}/rotation`);
        defined.add(`${transform}/scale`);
    }
    return (path, typeName, get, set, readOnly) => {
        if (defined.has(path)) bind(path, typeName, get, set, readOnly);
    };
}

function getPath(target: any, segments: readonly string[]): unknown {
    return segments.reduce((value, segment) => value?.[segment], target);
}

function textureBindings(materialIndex: number): TextureBinding[] {
    const prefix = `/materials/${materialIndex}`;
    return [
        { path: `${prefix}/pbrMetallicRoughness/baseColorTexture`, select: (material) => isColorMaterial(material) ? material.map : null },
        { path: `${prefix}/pbrMetallicRoughness/metallicRoughnessTexture`, select: (material) => isStandardMaterial(material) ? material.metalnessMap ?? material.roughnessMap : null },
        { path: `${prefix}/normalTexture`, select: (material) => isStandardMaterial(material) ? material.normalMap : null },
        { path: `${prefix}/occlusionTexture`, select: (material) => isStandardMaterial(material) ? material.aoMap : null },
        { path: `${prefix}/emissiveTexture`, select: (material) => isStandardMaterial(material) ? material.emissiveMap : null },
        { path: `${prefix}/extensions/KHR_materials_anisotropy/anisotropyTexture`, select: physicalTexture("anisotropyMap") },
        { path: `${prefix}/extensions/KHR_materials_clearcoat/clearcoatTexture`, select: physicalTexture("clearcoatMap") },
        { path: `${prefix}/extensions/KHR_materials_clearcoat/clearcoatRoughnessTexture`, select: physicalTexture("clearcoatRoughnessMap") },
        { path: `${prefix}/extensions/KHR_materials_clearcoat/clearcoatNormalTexture`, select: physicalTexture("clearcoatNormalMap") },
        { path: `${prefix}/extensions/KHR_materials_iridescence/iridescenceTexture`, select: physicalTexture("iridescenceMap") },
        { path: `${prefix}/extensions/KHR_materials_iridescence/iridescenceThicknessTexture`, select: physicalTexture("iridescenceThicknessMap") },
        { path: `${prefix}/extensions/KHR_materials_sheen/sheenColorTexture`, select: physicalTexture("sheenColorMap") },
        { path: `${prefix}/extensions/KHR_materials_sheen/sheenRoughnessTexture`, select: physicalTexture("sheenRoughnessMap") },
        { path: `${prefix}/extensions/KHR_materials_specular/specularTexture`, select: physicalTexture("specularIntensityMap") },
        { path: `${prefix}/extensions/KHR_materials_specular/specularColorTexture`, select: physicalTexture("specularColorMap") },
        { path: `${prefix}/extensions/KHR_materials_transmission/transmissionTexture`, select: physicalTexture("transmissionMap") },
        { path: `${prefix}/extensions/KHR_materials_volume/thicknessTexture`, select: physicalTexture("thicknessMap") },
    ];
}

function bindTexturePointers(bind: ThreePointerBinder, binding: TextureBinding, materials: Material[], source: any): void {
    if (source === undefined) {
        return;
    }
    const textures = unique(materials.map(binding.select).filter((texture): texture is Texture => texture !== null));
    let channel = source.extensions?.KHR_texture_transform?.texCoord ?? source.texCoord ?? 0;
    let offset = [...(source.extensions?.KHR_texture_transform?.offset ?? [0, 0])];
    let scale = [...(source.extensions?.KHR_texture_transform?.scale ?? [1, 1])];
    let rotation = source.extensions?.KHR_texture_transform?.rotation ?? 0;

    bind(`${binding.path}/texCoord`, "int", () => [channel], (value) => {
        channel = scalar(value);
        textures.forEach((texture) => texture.channel = channel);
        markNeedsUpdate(materials);
    });

    const transform = `${binding.path}/extensions/KHR_texture_transform`;
    bind(`${transform}/offset`, "float2", () => [...offset], (value) => {
        offset = asArray(value);
        textures.forEach((texture) => texture.offset.fromArray(offset));
    });
    bind(`${transform}/scale`, "float2", () => [...scale], (value) => {
        scale = asArray(value);
        textures.forEach((texture) => texture.repeat.fromArray(scale));
    });
    bind(`${transform}/rotation`, "float", () => [rotation], (value) => {
        rotation = scalar(value);
        textures.forEach((texture) => texture.rotation = rotation);
    });
}

function bindStoredScalar(bind: ThreePointerBinder, path: string, initialValue: number): void {
    let value = initialValue;
    bind(path, "float", () => [value], (next) => value = scalar(next));
}

function bindStoredColor(bind: ThreePointerBinder, path: string, initialValue: number[]): void {
    let value = [...initialValue];
    bind(path, "float3", () => [...value], (next) => value = asArray(next));
}

function bindScalar<T extends Material>(
    bind: ThreePointerBinder,
    path: string,
    materials: T[],
    get: (material: T) => number,
    set: (material: T, value: number) => void,
): void {
    if (materials.length === 0) {
        return;
    }
    bind(path, "float", () => [get(materials[0])], (value) => {
        materials.forEach((material) => set(material, scalar(value)));
        markNeedsUpdate(materials);
    });
}

function bindColor<T extends Material>(
    bind: ThreePointerBinder,
    path: string,
    materials: T[],
    select: (material: T) => { r: number; g: number; b: number; setRGB(r: number, g: number, b: number): unknown },
): void {
    if (materials.length === 0) {
        return;
    }
    const first = select(materials[0]);
    bind(path, "float3", () => [first.r, first.g, first.b], (value) => {
        const next = asArray(value);
        materials.forEach((material) => select(material).setRGB(next[0], next[1], next[2]));
        markNeedsUpdate(materials);
    });
}

function physicalTexture(property: keyof MeshPhysicalMaterial): (material: Material) => Texture | null {
    return (material) => {
        if (!isPhysicalMaterial(material)) {
            return null;
        }
        const value = material[property];
        return (value as Texture | undefined)?.isTexture ? value as Texture : null;
    };
}

function isColorMaterial(material: Material): material is ColorMaterial {
    return Boolean((material as MeshBasicMaterial).isMeshBasicMaterial || (material as MeshStandardMaterial).isMeshStandardMaterial);
}

function isStandardMaterial(material: Material): material is MeshStandardMaterial {
    return Boolean((material as MeshStandardMaterial).isMeshStandardMaterial);
}

function isPhysicalMaterial(material: Material): material is MeshPhysicalMaterial {
    return Boolean((material as MeshPhysicalMaterial).isMeshPhysicalMaterial);
}

function setNormalScale(target: { x: number; y: number; set(x: number, y: number): unknown }, value: number): void {
    target.set(value, target.y < 0 ? -value : value);
}

function markNeedsUpdate(materials: Material[]): void {
    materials.forEach((material) => material.needsUpdate = true);
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function asArray(value: unknown): number[] {
    return Array.isArray(value) ? value.map(Number) : [Number(value)];
}

function scalar(value: unknown): number {
    return Number(Array.isArray(value) ? value[0] : value);
}
