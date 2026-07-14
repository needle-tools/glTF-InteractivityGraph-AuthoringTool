import {BehaveEngineNode, IBehaviourNodeProps} from "../../BehaveEngineNode";

export class EventStopPropagation extends BehaveEngineNode {
    REQUIRED_VALUES = {stopImmediate: {}, event: {}}

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = 'EventStopPropagation';
        this.validateValues(this.values);
    }

    processNode(flowSocket?: string) {
        const {stopImmediate, event} = this.evaluateAllValues(Object.keys(this.REQUIRED_VALUES));

        this.graphEngine.stopEventPropagation(event, stopImmediate);

        super.processNode(flowSocket);
    }
}
