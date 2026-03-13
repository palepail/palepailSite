import { TerrainSpritePoint, TerrainSpriteRegion } from './monkeys.types';

export interface TerrainSpriteAnalyzerOptions {
  alphaThreshold?: number;
  minimumPixelCount?: number;
  outlinePointStride?: number;
}

interface BoundarySegment {
  start: TerrainSpritePoint;
  end: TerrainSpritePoint;
}

export class TerrainSpriteAnalyzer {
  analyze(
    image: HTMLImageElement | HTMLCanvasElement,
    options: TerrainSpriteAnalyzerOptions = {},
  ): TerrainSpriteRegion[] {
    const alphaThreshold = options.alphaThreshold ?? 96;
    const minimumPixelCount = options.minimumPixelCount ?? 24;
    const outlinePointStride = Math.max(1, options.outlinePointStride ?? 2);

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Unable to create image analysis context.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const solidMask = new Uint8Array(width * height);
    for (let index = 0; index < solidMask.length; index++) {
      solidMask[index] = data[index * 4 + 3] >= alphaThreshold ? 1 : 0;
    }

    const visited = new Uint8Array(width * height);
    const detectedRegions: TerrainSpriteRegion[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = y * width + x;
        if (!solidMask[pixelIndex] || visited[pixelIndex]) {
          continue;
        }

        const component = this.collectConnectedComponent(x, y, width, height, solidMask, visited);
        if (component.pixelCount < minimumPixelCount) {
          continue;
        }

        detectedRegions.push({
          id: detectedRegions.length,
          x: component.minX,
          y: component.minY,
          width: component.maxX - component.minX + 1,
          height: component.maxY - component.minY + 1,
          pixelCount: component.pixelCount,
          outline: this.buildOutline(
            component.pixels,
            component.minX,
            component.minY,
            width,
            height,
            solidMask,
            outlinePointStride,
          ),
        });
      }
    }

    detectedRegions.sort((left, right) => left.y - right.y || left.x - right.x);
    return detectedRegions.map((region, index) => ({ ...region, id: index }));
  }

  private collectConnectedComponent(
    startX: number,
    startY: number,
    width: number,
    height: number,
    solidMask: Uint8Array,
    visited: Uint8Array,
  ) {
    const queueX: number[] = [startX];
    const queueY: number[] = [startY];
    const pixels: number[] = [];
    visited[startY * width + startX] = 1;

    let head = 0;
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;

    while (head < queueX.length) {
      const x = queueX[head];
      const y = queueY[head];
      head++;

      pixels.push(y * width + x);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (let deltaY = -1; deltaY <= 1; deltaY++) {
        for (let deltaX = -1; deltaX <= 1; deltaX++) {
          if (deltaX === 0 && deltaY === 0) {
            continue;
          }

          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }

          const nextIndex = nextY * width + nextX;
          if (!solidMask[nextIndex] || visited[nextIndex]) {
            continue;
          }

          visited[nextIndex] = 1;
          queueX.push(nextX);
          queueY.push(nextY);
        }
      }
    }

    return {
      pixels,
      pixelCount: pixels.length,
      minX,
      maxX,
      minY,
      maxY,
    };
  }

  private buildOutline(
    pixels: number[],
    minX: number,
    minY: number,
    width: number,
    height: number,
    solidMask: Uint8Array,
    outlinePointStride: number,
  ): TerrainSpritePoint[] {
    const segments: BoundarySegment[] = [];

    for (const pixelIndex of pixels) {
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);

      if (!this.isSolid(x, y - 1, width, height, solidMask)) {
        segments.push({
          start: { x: x - minX, y: y - minY },
          end: { x: x + 1 - minX, y: y - minY },
        });
      }
      if (!this.isSolid(x + 1, y, width, height, solidMask)) {
        segments.push({
          start: { x: x + 1 - minX, y: y - minY },
          end: { x: x + 1 - minX, y: y + 1 - minY },
        });
      }
      if (!this.isSolid(x, y + 1, width, height, solidMask)) {
        segments.push({
          start: { x: x + 1 - minX, y: y + 1 - minY },
          end: { x: x - minX, y: y + 1 - minY },
        });
      }
      if (!this.isSolid(x - 1, y, width, height, solidMask)) {
        segments.push({
          start: { x: x - minX, y: y + 1 - minY },
          end: { x: x - minX, y: y - minY },
        });
      }
    }

    const tracedOutline = this.traceLargestBoundaryLoop(segments);
    if (tracedOutline.length === 0) {
      return tracedOutline;
    }

    const simplifiedOutline = this.removeCollinearPoints(tracedOutline);
    if (simplifiedOutline.length <= outlinePointStride || outlinePointStride <= 1) {
      return simplifiedOutline;
    }

    const stridedOutline = simplifiedOutline.filter((_, index) => index % outlinePointStride === 0);
    if (stridedOutline.length < 3) {
      return simplifiedOutline;
    }

    return stridedOutline;
  }

  private traceLargestBoundaryLoop(segments: BoundarySegment[]): TerrainSpritePoint[] {
    if (segments.length === 0) {
      return [];
    }

    const outgoingSegments = new Map<string, BoundarySegment[]>();
    for (const segment of segments) {
      const startKey = this.getPointKey(segment.start);
      const segmentList = outgoingSegments.get(startKey) ?? [];
      segmentList.push(segment);
      outgoingSegments.set(startKey, segmentList);
    }

    const consumedSegments = new Set<string>();
    const loops: TerrainSpritePoint[][] = [];

    for (const segment of segments) {
      const segmentKey = this.getSegmentKey(segment);
      if (consumedSegments.has(segmentKey)) {
        continue;
      }

      const loop: TerrainSpritePoint[] = [segment.start];
      let currentSegment = segment;

      while (true) {
        const currentSegmentKey = this.getSegmentKey(currentSegment);
        if (consumedSegments.has(currentSegmentKey)) {
          break;
        }

        consumedSegments.add(currentSegmentKey);
        loop.push(currentSegment.end);

        if (currentSegment.end.x === segment.start.x && currentSegment.end.y === segment.start.y) {
          break;
        }

        const nextSegments = outgoingSegments.get(this.getPointKey(currentSegment.end)) ?? [];
        const nextSegment = nextSegments.find(
          (candidate) => !consumedSegments.has(this.getSegmentKey(candidate)),
        );
        if (!nextSegment) {
          break;
        }

        currentSegment = nextSegment;
      }

      if (loop.length > 2) {
        loops.push(loop);
      }
    }

    if (loops.length === 0) {
      return [];
    }

    const largestLoop = loops.sort((left, right) => right.length - left.length)[0];
    if (largestLoop.length > 1) {
      const lastPoint = largestLoop[largestLoop.length - 1];
      const firstPoint = largestLoop[0];
      if (lastPoint.x === firstPoint.x && lastPoint.y === firstPoint.y) {
        largestLoop.pop();
      }
    }

    return largestLoop;
  }

  private removeCollinearPoints(points: TerrainSpritePoint[]): TerrainSpritePoint[] {
    if (points.length <= 3) {
      return points;
    }

    const simplifiedPoints: TerrainSpritePoint[] = [];
    for (let index = 0; index < points.length; index++) {
      const previousPoint = points[(index - 1 + points.length) % points.length];
      const currentPoint = points[index];
      const nextPoint = points[(index + 1) % points.length];
      const previousDeltaX = currentPoint.x - previousPoint.x;
      const previousDeltaY = currentPoint.y - previousPoint.y;
      const nextDeltaX = nextPoint.x - currentPoint.x;
      const nextDeltaY = nextPoint.y - currentPoint.y;
      const crossProduct = previousDeltaX * nextDeltaY - previousDeltaY * nextDeltaX;

      if (crossProduct !== 0) {
        simplifiedPoints.push(currentPoint);
      }
    }

    return simplifiedPoints.length >= 3 ? simplifiedPoints : points;
  }

  private getPointKey(point: TerrainSpritePoint): string {
    return `${point.x},${point.y}`;
  }

  private getSegmentKey(segment: BoundarySegment): string {
    return `${this.getPointKey(segment.start)}>${this.getPointKey(segment.end)}`;
  }

  private isSolid(
    x: number,
    y: number,
    width: number,
    height: number,
    solidMask: Uint8Array,
  ): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return false;
    }

    return solidMask[y * width + x] === 1;
  }
}
