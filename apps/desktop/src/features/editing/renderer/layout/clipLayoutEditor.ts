import { projectEdits } from "#features/editing/renderer/edits";
import {
  DEFAULT_FEED_FRAMING,
  defaultClipLayout,
  layoutSources,
  type ClipLayout,
  type FeedFraming,
  type LayoutSource,
} from "../../domain/clipLayout.ts";
import { piecesOf } from "#project-document/domain/recording";

import type { Project } from "#project-document/domain/recording";

/** The inspector and stage edit the same current layout, including legacy camera-layout defaults. */
export class ClipLayoutEditor {
  #project: () => Project;

  constructor(project: () => Project) {
    this.#project = project;
  }

  layout(pieceId: string, sources: readonly LayoutSource[]): ClipLayout | undefined {
    const piece = piecesOf(this.#project()).find((piece) => piece.id === pieceId);
    return piece && (piece.layout ?? defaultClipLayout(sources, piece.cameraLayout));
  }

  feed(pieceId: string, sources: readonly LayoutSource[], id: string): FeedFraming {
    return { ...DEFAULT_FEED_FRAMING, ...this.layout(pieceId, sources)?.feeds[id] };
  }

  update(
    pieceId: string,
    sources: readonly LayoutSource[],
    patch: Partial<ClipLayout> | ((layout: ClipLayout) => Partial<ClipLayout>),
  ): void {
    const project = this.#project();
    const pieces = piecesOf(project);
    if (!pieces.some((piece) => piece.id === pieceId)) return;
    projectEdits.setPieces(
      project,
      pieces.map((piece) => {
        if (piece.id !== pieceId) return piece;
        const layout = piece.layout ?? defaultClipLayout(sources, piece.cameraLayout);
        return {
          ...piece,
          layout: {
            ...layout,
            sources: layoutSources(layout, sources),
            ...(typeof patch === "function" ? patch(layout) : patch),
          },
        };
      }),
    );
  }

  updateFeed(
    pieceId: string,
    sources: readonly LayoutSource[],
    id: string,
    patch: Partial<FeedFraming>,
  ): void {
    this.update(pieceId, sources, (layout) => ({
      feeds: { ...layout.feeds, [id]: { ...DEFAULT_FEED_FRAMING, ...layout.feeds[id], ...patch } },
    }));
  }
}
