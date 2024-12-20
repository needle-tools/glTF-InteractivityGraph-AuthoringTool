import {BehaveEngineNode, IBehaviourNodeProps} from "../../../BehaveEngineNode";

export class Exponential extends BehaveEngineNode {
    REQUIRED_VALUES = [{id:"a"}]

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "ExponentialNode";
        this.validateValues(this.values);
    }

    override processNode(flowSocket?: string) {
        const {a} = this.evaluateAllValues(this.REQUIRED_VALUES.map(val => val.id));
        this.graphEngine.processNodeStarted(this);
        const typeIndexA = this.values['a'].type!
        const typeA: string = this.getType(typeIndexA);
        let val: any;

        switch (typeA) {
            case "float":
                val = [Math.exp(a)]
                break;
            case "float2":
                val = [
                    Math.exp(a[0]),
                    Math.exp(a[1])
                ]
                break;
            case "float3":
                val = [
                    Math.exp(a[0]),
                    Math.exp(a[1]),
                    Math.exp(a[2]),
                ]
                break;
            case "float4":
                val = [
                    Math.exp(a[0]),
                    Math.exp(a[1]),
                    Math.exp(a[2]),
                    Math.exp(a[3]),
                ]
                break
            default:
                throw Error("Invalid type")
        }

        return {'value': {id: "value", value: val, type: typeIndexA}}
    }
}
