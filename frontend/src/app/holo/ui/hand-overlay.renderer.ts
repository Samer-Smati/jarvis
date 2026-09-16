import type { HandFrame } from '../types/holo.types';

/** MediaPipe's hand skeleton: pairs of landmark indices that form the bones. */
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const HAND_COLOR = { left: '#7dffd9', right: '#ffc46a', unknown: '#9aa7b2' } as const;

/**
 * Draws the tracked skeleton onto a 2D canvas. Pure rendering — it reads a frame
 * and paints, holding no state and knowing nothing about gestures.
 */
export function drawHandFrame(
  ctx: CanvasRenderingContext2D,
  frame: HandFrame,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  for (const hand of frame.hands) {
    const color = HAND_COLOR[hand.handedness];
    // The preview is mirrored, so x is flipped to land on the user's actual hand.
    const px = (i: number) => (1 - hand.landmarks[i].x) * width;
    const py = (i: number) => hand.landmarks[i].y * height;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    for (let i = 0; i < hand.landmarks.length; i++) {
      // Fingertips are the landmarks gestures care about, so draw them larger.
      const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(px(i), py(i), isTip ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
