import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { BrainGraph, BrainGraphEdge, GraphLayoutNode } from '../core/models';
import { BrainGraphService } from './brain-graph.service';

const CATEGORY_COLORS: Record<string, string> = {
  concept: '#b4a7d6',
  entity: '#a78bfa',
  source: '#6b6b6b',
  fact: '#7a7a7a',
  session: '#5c5c5c',
};

const SELECTED_COLOR = '#c4b5fd';
const NEIGHBOR_COLOR = '#8b8b8b';
const DEFAULT_NODE_R = 7;

@Component({
  selector: 'app-brain-graph',
  templateUrl: './brain-graph.component.html',
  styleUrls: ['./brain-graph.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrainGraphComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() visible = false;
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLElement>;

  layoutNodes: GraphLayoutNode[] = [];
  edges: BrainGraphEdge[] = [];
  loading = false;
  error: string | null = null;
  nodeCount = 0;
  edgeCount = 0;
  updatedAt = '';
  selectedId: string | null = null;
  width = 800;
  height = 520;

  private subs = new Subscription();
  private raf = 0;
  private dragNode: GraphLayoutNode | null = null;

  constructor(
    private api: ApiService,
    private brainGraph: BrainGraphService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      this.onVisibleChange(!!this.visible);
    }
  }

  close(): void {
    this.brainGraph.close();
  }

  ngAfterViewInit(): void {
    this.resize();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    cancelAnimationFrame(this.raf);
  }

  onVisibleChange(active: boolean): void {
    if (active) {
      setTimeout(() => {
        this.resize();
        this.fetchGraph(true);
        this.startPolling();
        this.startSimulation();
      }, 0);
    } else {
      this.subs.unsubscribe();
      this.subs = new Subscription();
      cancelAnimationFrame(this.raf);
    }
  }

  refresh(): void {
    this.fetchGraph(true);
  }

  selectNode(node: GraphLayoutNode, event?: Event): void {
    event?.stopPropagation();
    this.selectedId = this.selectedId === node.id ? null : node.id;
    this.cdr.markForCheck();
  }

  clearSelection(): void {
    if (this.selectedId) {
      this.selectedId = null;
      this.cdr.markForCheck();
    }
  }

  nodeRadius(_node: GraphLayoutNode): number {
    return DEFAULT_NODE_R;
  }

  labelOffset(_node: GraphLayoutNode): number {
    return 18;
  }

  nodeFill(node: GraphLayoutNode): string {
    if (this.selectedId === node.id) {
      return SELECTED_COLOR;
    }
    if (this.selectedId && this.isNodeHighlighted(node)) {
      return NEIGHBOR_COLOR;
    }
    return CATEGORY_COLORS[node.category] ?? '#7a7a7a';
  }

  isNodeDimmed(node: GraphLayoutNode): boolean {
    if (!this.selectedId) {
      return false;
    }
    return node.id !== this.selectedId && !this.isNodeHighlighted(node);
  }

  isEdgeDimmed(edge: BrainGraphEdge): boolean {
    if (!this.selectedId) {
      return false;
    }
    return !this.isEdgeHighlighted(edge);
  }

  categoryColor(category: string): string {
    return CATEGORY_COLORS[category] ?? '#17d1ff';
  }

  nodeCoord(id: string): { x: number; y: number } | undefined {
    const node = this.layoutNodes.find((n) => n.id === id);
    return node ? { x: node.x, y: node.y } : undefined;
  }

  isEdgeHighlighted(edge: BrainGraphEdge): boolean {
    if (!this.selectedId) {
      return false;
    }
    return edge.source === this.selectedId || edge.target === this.selectedId;
  }

  isNodeHighlighted(node: GraphLayoutNode): boolean {
    if (!this.selectedId) {
      return false;
    }
    if (node.id === this.selectedId) {
      return true;
    }
    return this.edges.some(
      (e) =>
        (e.source === this.selectedId && e.target === node.id) ||
        (e.target === this.selectedId && e.source === node.id),
    );
  }

  onPointerDown(event: PointerEvent, node: GraphLayoutNode): void {
    event.stopPropagation();
    this.dragNode = node;
    this.selectedId = node.id;
    (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
    this.cdr.markForCheck();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragNode || !this.canvasRef?.nativeElement) {
      return;
    }
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    this.dragNode.x = event.clientX - rect.left;
    this.dragNode.y = event.clientY - rect.top;
    this.dragNode.vx = 0;
    this.dragNode.vy = 0;
  }

  onPointerUp(): void {
    this.dragNode = null;
  }

  private startPolling(): void {
    this.subs.add(
      interval(3000)
        .pipe(switchMap(() => this.api.brainGraph()))
        .subscribe({
          next: (graph) => this.zone.run(() => this.applyGraph(graph, false)),
          error: () => undefined,
        }),
    );
  }

  private fetchGraph(showLoading: boolean): void {
    if (showLoading) {
      this.loading = true;
      this.error = null;
      this.cdr.markForCheck();
    }
    this.api.brainGraph().subscribe({
      next: (graph) => this.zone.run(() => this.applyGraph(graph, showLoading)),
      error: () =>
        this.zone.run(() => {
          this.loading = false;
          this.error = 'Could not load brain graph, sir.';
          this.cdr.markForCheck();
        }),
    });
  }

  private applyGraph(graph: BrainGraph, showLoading: boolean): void {
    const prev = new Map(this.layoutNodes.map((n) => [n.id, n]));
    this.edges = graph.edges;
    this.nodeCount = graph.nodes.length;
    this.edgeCount = graph.edges.length;
    this.updatedAt = graph.updatedAt;
    this.resize();

    this.layoutNodes = graph.nodes.map((n, i) => {
      const existing = prev.get(n.id);
      const angle = (i / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
      const radius = Math.min(this.width, this.height) * 0.38;
      const cx = this.width / 2;
      const cy = this.height / 2;
      return {
        ...n,
        x: existing?.x ?? cx + Math.cos(angle) * radius,
        y: existing?.y ?? cy + Math.sin(angle) * radius,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
      };
    });

    this.loading = false;
    this.error = graph.nodes.length ? null : 'Brain is empty — ask JARVIS to remember something first.';
    this.cdr.markForCheck();
    if (showLoading) {
      this.startSimulation();
    }
  }

  private resize(): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    this.width = Math.max(320, rect.width || 800);
    this.height = Math.max(280, rect.height || 520);
  }

  private startSimulation(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.visible || !this.layoutNodes.length) {
        return;
      }
      this.stepPhysics();
      this.cdr.markForCheck();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stepPhysics(): void {
    const nodes = this.layoutNodes;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const repulsion = 9500;
    const spring = 0.028;
    const damping = 0.88;
    const centerPull = 0.004;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = repulsion / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        if (a !== this.dragNode) {
          a.vx -= dx;
          a.vy -= dy;
        }
        if (b !== this.dragNode) {
          b.vx += dx;
          b.vy += dy;
        }
      }
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of this.edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = 155 + (a.linkCount + b.linkCount) * 4;
      const force = (dist - rest) * spring;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (a !== this.dragNode) {
        a.vx += fx;
        a.vy += fy;
      }
      if (b !== this.dragNode) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const node of nodes) {
      if (node === this.dragNode) {
        continue;
      }
      node.vx += (cx - node.x) * centerPull;
      node.vy += (cy - node.y) * centerPull;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(40, Math.min(this.width - 40, node.x));
      node.y = Math.max(40, Math.min(this.height - 40, node.y));
    }
  }
}
