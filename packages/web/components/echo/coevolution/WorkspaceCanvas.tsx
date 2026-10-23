"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight,
  Check,
  FileText,
  Focus,
  GitBranch,
  Minus,
  Plus,
  Quote,
  ScanLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceCopy, WorkspaceFeature } from "./workspace-copy";
import type { WorkspaceProjection } from "./workspace-model";
import { compactWorkspaceText } from "./workspace-model";
import "@xyflow/react/dist/style.css";

type CanvasData = Record<string, unknown> & {
  kind: "source" | "action" | "result";
  projection: WorkspaceProjection;
  copy: WorkspaceCopy;
  onSource: () => void;
  onResult: () => void;
  onContinue: () => void;
  onFocusNode: (id: string) => void;
};
type CanvasNode = Node<CanvasData, "workspace">;
interface Props {
  projection: WorkspaceProjection;
  feature: WorkspaceFeature;
  copy: WorkspaceCopy;
  taskId: string;
  onSource: () => void;
  onResult: () => void;
  onContinue: () => void;
}

const WorkspaceNode = memo(function WorkspaceNode({
  id,
  data,
}: NodeProps<CanvasNode>) {
  const { kind, projection, copy } = data;
  const onFocus = (event: React.FocusEvent) => {
    if ((event.target as HTMLElement).matches(":focus-visible"))
      data.onFocusNode(id);
  };
  return (
    <article
      className={`co-workspace-node co-workspace-node-${kind}`}
      data-pending={kind === "result" && projection.result.pending}
      data-failed={kind === "result" && projection.result.failed}
      data-closed={kind === "result" && projection.result.closed}
      onFocusCapture={onFocus}
    >
      {kind !== "source" && (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      {kind !== "result" && (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      )}
      {kind === "source" ? (
        <>
          <div className="co-node-eyebrow">
            <FileText size={13} />
            <span>
              {projection.source.provenance === "session"
                ? copy.sourceSession
                : projection.source.provenance === "run"
                  ? copy.sourceRun
                  : projection.source.provenance === "proposal"
                    ? copy.sourceProposal
                    : projection.source.sourceTitle || copy.taskNote}
            </span>
          </div>
          <h2>
            {compactWorkspaceText(
              projection.source.title || projection.source.sourceTitle || copy.source,
              48,
            )}
          </h2>
          <div className="co-source-paper">
            <span className="co-paper-line" />
            <p>{compactWorkspaceText(projection.source.body, 110)}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="co-node-link nodrag"
            onClick={data.onSource}
          >
            <Quote size={13} />
            {copy.sourceDetail}
            <ArrowRight size={13} />
          </Button>
        </>
      ) : kind === "action" ? (
        <>
          <div className="co-node-eyebrow">
            <span className="co-now-dot" />
            <span>{copy.current}</span>
            <span className="co-action-state">
              {copy.status[projection.action.state]}
            </span>
          </div>
          <h2>{compactWorkspaceText(projection.action.title, 70)}</h2>
          {projection.action.body && (
            <p className="co-node-description">
              {compactWorkspaceText(projection.action.body, 85)}
            </p>
          )}
          {projection.action.detail && (
            <p className="co-node-detail">
              {compactWorkspaceText(projection.action.detail, 85)}
            </p>
          )}
          <Button
            variant="amber"
            size="xl"
            className="co-node-continue nodrag"
            onClick={data.onContinue}
          >
            {projection.action.cta}
            <ArrowRight size={15} />
          </Button>
        </>
      ) : (
        <>
          <div className="co-node-eyebrow">
            {projection.result.pending ? (
              <span className="co-pending-dot" />
            ) : (
              <Check size={13} />
            )}
            <span>
              {projection.result.closed
                ? copy.closed
                : projection.result.pending
                  ? copy.pending
                  : projection.result.evidenceLabel || copy.recorded}
            </span>
          </div>
          <h2>{compactWorkspaceText(projection.result.title, 45)}</h2>
          <p className="co-node-description">
            {compactWorkspaceText(projection.result.body, 120)}
          </p>
          {!projection.result.pending && (
            <Button
              variant="ghost"
              size="sm"
              className="co-node-link nodrag"
              onClick={data.onResult}
            >
              <ScanLine size={13} />
              {copy.resultDetail}
              <ArrowRight size={13} />
            </Button>
          )}
        </>
      )}
    </article>
  );
});
const nodeTypes = { workspace: WorkspaceNode };

export function WorkspaceCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasStage {...props} />
    </ReactFlowProvider>
  );
}

function CanvasStage({
  projection,
  feature,
  copy,
  taskId,
  onSource,
  onResult,
  onContinue,
}: Props) {
  const flow = useReactFlow<CanvasNode>();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const initialized = useNodesInitialized();
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [ready, setReady] = useState(false);
  const lastCamera = useRef("");
  const duration = useCallback(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 220,
    [],
  );
  const focus = useCallback(
    (id: string) => {
      void flow.fitView({
        nodes: [{ id }],
        minZoom: 0.7,
        maxZoom: 1.05,
        padding: { top: "48px", bottom: "65px", x: "24px" },
        duration: duration(),
      });
    },
    [flow, duration],
  );
  const overview = useCallback(() => {
    void flow.fitView({
      minZoom: 0.3,
      maxZoom: 1,
      padding: { top: "52px", bottom: "70px", x: "20px" },
      duration: duration(),
    });
  }, [flow, duration]);
  const follow = useCallback(() => {
    if (width < 620) focus("action");
    else overview();
  }, [width, focus, overview]);
  const measureNodes = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setMeasurements((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        if (
          current[change.id]?.width === change.dimensions.width &&
          current[change.id]?.height === change.dimensions.height
        )
          continue;
        if (next === current) next = { ...current };
        next[change.id] = change.dimensions;
      }
      return next;
    });
  }, []);
  const nodes: CanvasNode[] = useMemo(
    () =>
      [
        { id: "source", position: { x: 0, y: 50 }, kind: "source" as const },
        { id: "action", position: { x: 220, y: 180 }, kind: "action" as const },
        { id: "result", position: { x: 520, y: 40 }, kind: "result" as const },
      ].map((node) => ({
        id: node.id,
        position: node.position,
        type: "workspace",
        measured: measurements[node.id],
        draggable: false,
        selectable: false,
        style: { pointerEvents: "all" },
        data: {
          kind: node.kind,
          projection,
          copy,
          onSource,
          onResult,
          onContinue,
          onFocusNode: focus,
        },
      })),
    [projection, copy, onSource, onResult, onContinue, measurements, focus],
  );
  const edges: Edge[] = useMemo(
    () => [
      {
        id: "context-action",
        source: "source",
        target: "action",
        style: { stroke: "var(--amber)", strokeWidth: 1.5 },
      },
      {
        id: "action-outcome",
        source: "action",
        target: "result",
        style: {
          stroke: projection.result.pending ? "var(--border)" : "var(--amber)",
          strokeWidth: 1.5,
          strokeDasharray: projection.result.pending ? "5 6" : undefined,
        },
      },
    ],
    [projection.result.pending],
  );
  useEffect(() => {
    const key = `${taskId}:${feature}:${projection.action.title}:${Math.round(width)}:${Math.round(height)}:${measurements.action?.height}:${measurements.source?.height}:${measurements.result?.height}`;
    if (
      !ready ||
      !initialized ||
      !width ||
      !height ||
      key === lastCamera.current
    )
      return;
    const frame = requestAnimationFrame(() => {
      lastCamera.current = key;
      follow();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    ready,
    initialized,
    width,
    height,
    taskId,
    feature,
    follow,
    projection.action.title,
    measurements,
  ]);

  return (
    <section
      className="co-workspace-canvas"
      aria-label={copy.canvas}
      data-camera-ready={ready && initialized}
    >
      <ReactFlow<CanvasNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={() => setReady(true)}
        onNodesChange={measureNodes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        autoPanOnNodeFocus={false}
        minZoom={0.3}
        maxZoom={1.6}
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
        zoomOnPinch
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        aria-label={copy.canvas}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--border)"
          gap={24}
          size={1}
        />
      </ReactFlow>
      <div className="co-canvas-caption">
        <GitBranch size={15} />
        <span>{copy.features[feature].label}</span>
        <span className="co-caption-separator" />
        <span>{copy.local}</span>
      </div>
      <div className="co-canvas-tools" role="group" aria-label={copy.canvas}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.zoomOut}
          onClick={() => void flow.zoomOut({ duration: duration() })}
        >
          <Minus size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.zoomIn}
          onClick={() => void flow.zoomIn({ duration: duration() })}
        >
          <Plus size={15} />
        </Button>
        <span className="co-tool-divider" />
        <Button variant="ghost" size="sm" onClick={overview}>
          <GitBranch size={14} />
          {copy.overview}
        </Button>
        <Button variant="ghost" size="sm" onClick={follow}>
          <Focus size={14} />
          {copy.focus}
        </Button>
      </div>
      <div className="co-canvas-direction" aria-hidden>
        <span>{copy.source}</span>
        <span>{copy.current}</span>
        <span>
          {projection.result.closed
            ? copy.closed
            : projection.result.pending
              ? copy.pending
              : copy.recorded}
        </span>
      </div>
    </section>
  );
}
