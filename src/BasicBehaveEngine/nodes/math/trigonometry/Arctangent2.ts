import {BehaveEngineNode, IBehaviourNodeProps} from "../../../BehaveEngineNode";

export class Arctangent2 extends BehaveEngineNode {
    REQUIRED_VALUES = [{id:"a"}, {id: "b"}]

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "Arctangent2Node";
        this.validateValues(this.values);
    }

    override processNode(flowSocket?: string) {
        const {a, b} = this.evaluateAllValues(this.REQUIRED_VALUES.map(val => val.id));
        this.graphEngine.processNodeStarted(this);
        const typeAIndex = this.values['a'].type!
        const typeA: string = this.getType(typeAIndex);
        const typeBIndex = this.values['b'].type!
        const typeB: string = this.getType(typeBIndex);
        if (typeA !== typeB) {
            throw Error("input types not equivalent")
        }
        let val: any;

        switch (typeA) {
            case "float":
                val = [Math.atan2(a, b)];
                break;
            case "float2":
                val = [
                    Math.atan2(a[0], b[0]),
                    Math.atan2(a[1], b[1])
                ]
                break;
            case "float3":
                val = [
                    Math.atan2(a[0], b[0]),
                    Math.atan2(a[1], b[1]),
                    Math.atan2(a[2], b[2]),
                ]
                break;
            case "float4":
                val = [
                    Math.atan2(a[0], b[0]),
                    Math.atan2(a[1], b[1]),
                    Math.atan2(a[2], b[2]),
                    Math.atan2(a[3], b[3]),
                ]
                break
            default:
                throw Error("Invalid type")
        }

        return {'value': {id: "value", value: val, type: typeAIndex}}
    }
}
