export {};

declare global {
  interface Window {
    /** Capture hook: set the layer stack to 0 (collapsed), 1..5 (a plane) or 6 (overview). */
    __setLayerStep?: (step: number | string) => string | null;
    /** Capture hook: how many SSE messages the current replay has received. */
    __replayFrameCount?: () => number;
    /** Capture hook: redraw the replay panel as it was after the first `count` received messages. */
    __setReplayFrame?: (count: number) => number;
    /** Capture hook: the replay connection's phase. */
    __replayPhase?: () => string;
  }
}
