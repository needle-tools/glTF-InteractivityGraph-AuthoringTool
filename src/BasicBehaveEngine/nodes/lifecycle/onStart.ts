import {BehaveEngineNode, IBehaviourNodeProps} from "../../BehaveEngineNode";

export class OnStartNode extends BehaveEngineNode {
    private readonly eventRef = "/extensions/KHR_interactivity/events/0";

    constructor(props: IBehaviourNodeProps) {
        super(props);
        this.name = "OnStart";
        this.outValues.event = { value: [null], type: this.getTypeIndex('ref') };
    }

    prepareEvent(): void {
        this.outValues.event.value = [this.eventRef];
        this.graphEngine.registerEventReference(this.eventRef);
    }

    override processNode(flowSocket?: string) {
        if (this.graphEngine.isEventImmediatePropagationCancelled(this.eventRef)) {
            return;
        }

        this.prepareEvent();
        this.graphEngine.processNodeStarted(this);
        return super.processNode(flowSocket);
    }
}
