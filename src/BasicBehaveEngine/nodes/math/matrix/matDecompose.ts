import {BehaveEngineNode, IBehaviourNodeProps} from "../../../BehaveEngineNode";
import * as glMatrix from "gl-matrix";

export class MatDecompose extends BehaveEngineNode {
    REQUIRED_VALUES = {a: {}}

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "MatDecompose";
        this.validateValues(this.values);
    }

    override processNode(flowSocket?: string) {
        const {a} = this.evaluateAllValues(Object.keys(this.REQUIRED_VALUES));
        this.graphEngine.processNodeStarted(this);
        const typeIndexA = this.values['a'].type!
        const typeA: string = this.getType(typeIndexA);

        const validTypePairings = (typeA === "float4x4")
        if (!validTypePairings) {
            throw Error("Invalid type for a")
        }

        const result = {
            'translation': {value: [0, 0, 0], type: this.getTypeIndex("float3")},
            'rotation': {value: [0, 0, 0, 1], type: this.getTypeIndex("float4")},
            'scale': {value: [1, 1, 1], type: this.getTypeIndex("float3")},
            'isValid': {value: true, type: this.getTypeIndex("bool")}
        }

        // check last row of matrix for valid transform matrix structure
        if (a[0][3] !== 0 || a[1][3] !== 0 || a[2][3] !== 0 || a[3][3] !== 1) {
            console.log("Invalid matrix structure")
            result.isValid.value = false;
            return result;
        }

        // Convert to gl-matrix format (column-major)
        const matrix = glMatrix.mat4.fromValues(
            a[0][0], a[0][1], a[0][2], a[0][3],
            a[1][0], a[1][1], a[1][2], a[1][3],
            a[2][0], a[2][1], a[2][2], a[2][3],
            a[3][0], a[3][1], a[3][2], a[3][3]
        );

        // Use gl-matrix's proper decomposition functions
        const translation = glMatrix.vec3.create();
        const rotation = glMatrix.quat.create();
        const scaling = glMatrix.vec3.create();

        glMatrix.mat4.getTranslation(translation, matrix);
        glMatrix.mat4.getRotation(rotation, matrix);
        glMatrix.mat4.getScaling(scaling, matrix);

        // Check for invalid values
        if (isNaN(scaling[0]) || isNaN(scaling[1]) || isNaN(scaling[2]) || 
            !isFinite(scaling[0]) || !isFinite(scaling[1]) || !isFinite(scaling[2]) ||
            isNaN(translation[0]) || isNaN(translation[1]) || isNaN(translation[2]) ||
            isNaN(rotation[0]) || isNaN(rotation[1]) || isNaN(rotation[2]) || isNaN(rotation[3])) {
            console.log("Invalid decomposition values")
            result.isValid.value = false;
            return result;
        }

        result.translation.value = [translation[0], translation[1], translation[2]];
        result.rotation.value = [rotation[0], rotation[1], rotation[2], rotation[3]];
        result.scale.value = [scaling[0], scaling[1], scaling[2]];

        return result;
    }
}
