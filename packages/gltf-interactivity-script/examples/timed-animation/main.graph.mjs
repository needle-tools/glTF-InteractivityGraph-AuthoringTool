import { defineGraph } from "gltf-interactivity-script";
export default defineGraph(({ g, node }) => {
  const selected = g.ops.event.onSelect({}, { nodeIndex: node("Target") });
  const delay = g.ops.flow.setDelay({ duration: g.float(0.05) });
  const play = g.ops.animation.start({
    animation: g.ref("/animations/0"),
    startTime: g.float(0),
    endTime: g.float(1),
    speed: g.float(2),
  });
  const finished = g.variable("animation finished", "bool", false);
  selected.flow().to(delay);
  delay.flow("done").to(play);
  play.flow("done").to(g.set(finished, g.bool(true)));
  const token = g.variable("timer token", "ref", "");
  delay.flow().to(g.set(token, delay.outputs.lastDelay));
  const cancel = g.event("cancel");
  const received = g.receive(cancel);
  const cancelTimer = g.ops.flow.cancelDelay({ delay: g.get(token) });
  received.flow().to(cancelTimer);
});
