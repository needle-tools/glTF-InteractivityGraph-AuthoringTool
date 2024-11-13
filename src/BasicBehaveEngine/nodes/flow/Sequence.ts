import {BehaveEngineNode, IBehaviourNodeProps} from "../../BehaveEngineNode";

export class Sequence extends BehaveEngineNode {
    _numberOutputFlows: number;

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "Sequence";
        this.validateValues(this.values);
        this.validateFlows(this.flows);
        this.validateConfigurations(this.configuration);

        this._numberOutputFlows = Object.keys(this.flows).length;
    }

    override processNode(flowSocket?: string) {
        this.graphEngine.processNodeStarted(this)

        const flows = Object.keys(this.flows);
        for (let i = 0; i < flows.length; i++) {
            const flow = this.flows[flows[i]];
            if (!flow) continue;
            this.processFlow(flow);
        }
    }
}
