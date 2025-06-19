import {BehaveEngineNode, IBehaviourNodeProps} from "../../../BehaveEngineNode";

export class Rotate3D extends BehaveEngineNode {
    REQUIRED_VALUES = {a: {}, b: {}}

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "Rotate3DNode";
        this.validateValues(this.values);
    }

    override processNode(flowSocket?: string) {
        const {a, b} = this.evaluateAllValues(Object.keys(this.REQUIRED_VALUES));
        this.graphEngine.processNodeStarted(this);
        const typeIndexA = this.values['a'].type!
        const typeA: string = this.getType(typeIndexA);
        const typeIndexB = this.values['b'].type!
        const typeB: string = this.getType(typeIndexB);

        if (typeA !== "float3" || typeB !== "float4") {
            throw Error("input types not correct, expected float3 for a and float4 for b")
        }

        const val = [0, 0, 0];
        val[0] = a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
        val[1] = a[1] * b[3] + a[2] * b[0] - a[0] * b[2];
        val[2] = a[2] * b[3] + a[0] * b[1] - a[1] * b[0];


        return {'value': {value: val, type: typeIndexA}}
    }
}
