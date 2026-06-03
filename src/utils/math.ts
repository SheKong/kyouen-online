import { Point } from '../types';

// Helper for 3x3 determinant
export function det3x3(
  a11: number, a12: number, a13: number,
  a21: number, a22: number, a23: number,
  a31: number, a32: number, a33: number
): number {
  return a11 * (a22 * a33 - a23 * a32)
       - a12 * (a21 * a33 - a23 * a31)
       + a13 * (a21 * a32 - a22 * a31);
}

// 4x4 determinant for concyclicity check
// The matrix rows are: [x_i, y_i, x_i^2 + y_i^2, 1]
// We expand along the 4th column (all 1s)
export function det4x4Concyclic(p1: Point, p2: Point, p3: Point, p4: Point): number {
  const z1 = p1.x * p1.x + p1.y * p1.y;
  const z2 = p2.x * p2.x + p2.y * p2.y;
  const z3 = p3.x * p3.x + p3.y * p3.y;
  const z4 = p4.x * p4.x + p4.y * p4.y;

  const m14 = det3x3(p2.x, p2.y, z2, p3.x, p3.y, z3, p4.x, p4.y, z4);
  const m24 = det3x3(p1.x, p1.y, z1, p3.x, p3.y, z3, p4.x, p4.y, z4);
  const m34 = det3x3(p1.x, p1.y, z1, p2.x, p2.y, z2, p4.x, p4.y, z4);
  const m44 = det3x3(p1.x, p1.y, z1, p2.x, p2.y, z2, p3.x, p3.y, z3);

  return -m14 + m24 - m34 + m44;
}

// Check if three points are collinear
export function areThreeCollinear(p1: Point, p2: Point, p3: Point): boolean {
  return p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y) === 0;
}

// Check if four points are collinear
export function areFourCollinear(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  return areThreeCollinear(p1, p2, p3) && areThreeCollinear(p1, p2, p4);
}

// Check if four points are concyclic (which includes collinear as a circle of infinite radius)
export function checkConcyclic(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  // Ensure the points are distinct
  const points = [p1, p2, p3, p4];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (points[i].x === points[j].x && points[i].y === points[j].y) {
        return false;
      }
    }
  }

  // The 4x4 determinant must be exactly zero
  const det = det4x4Concyclic(p1, p2, p3, p4);
  if (det !== 0) {
    return false;
  }

  // If any 3 points are collinear, then for det to be 0, all 4 must be collinear.
  const threeCollinear = areThreeCollinear(p1, p2, p3) ||
                         areThreeCollinear(p1, p2, p4) ||
                         areThreeCollinear(p1, p3, p4) ||
                         areThreeCollinear(p2, p3, p4);

  if (threeCollinear) {
    // If three are collinear, all four must be collinear to count as concyclic (at infinite radius)
    return areFourCollinear(p1, p2, p3, p4);
  }

  return true;
}

// Calculate the center and radius of a circle through three non-collinear points
export function calculateCircle(p1: Point, p2: Point, p3: Point): { center: Point; radius: number } | null {
  const A1 = 2 * (p2.x - p1.x);
  const B1 = 2 * (p2.y - p1.y);
  const C1 = (p2.x * p2.x - p1.x * p1.x) + (p2.y * p2.y - p1.y * p1.y);

  const A2 = 2 * (p3.x - p2.x);
  const B2 = 2 * (p3.y - p2.y);
  const C2 = (p3.x * p3.x - p2.x * p2.x) + (p3.y * p3.y - p2.y * p2.y);

  const D = A1 * B2 - A2 * B1;
  if (Math.abs(D) < 1e-9) {
    return null; // Collinear
  }

  const xc = (C1 * B2 - C2 * B1) / D;
  const yc = (A1 * C2 - A2 * C1) / D;
  const radius = Math.sqrt((xc - p1.x) * (xc - p1.x) + (yc - p1.y) * (yc - p1.y));

  return { center: { x: xc, y: yc }, radius };
}

// Scans all combinations of 4 points on the current board plate and extracts concyclic descriptions
export function findAllConcyclicGroups(points: Point[]): { points: Point[]; type: 'circle' | 'line'; center?: Point; radius?: number }[] {
  const n = points.length;
  if (n < 4) return [];

  const results: { points: Point[]; type: 'circle' | 'line'; center?: Point; radius?: number }[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const p1 = points[i];
          const p2 = points[j];
          const p3 = points[k];
          const p4 = points[l];

          if (checkConcyclic(p1, p2, p3, p4)) {
            // Check if collinear
            if (areFourCollinear(p1, p2, p3, p4)) {
              results.push({
                points: [p1, p2, p3, p4],
                type: 'line',
              });
            } else {
              const circ = calculateCircle(p1, p2, p3);
              if (circ) {
                results.push({
                  points: [p1, p2, p3, p4],
                  type: 'circle',
                  center: circ.center,
                  radius: circ.radius,
                });
              }
            }
          }
        }
      }
    }
  }

  return results;
}

function gcd2(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { let temp = b; b = a % b; a = temp; }
  return a;
}

function gcd4(a: number, b: number, c: number, d: number): number {
  return gcd2(gcd2(a, b), gcd2(c, d));
}

// Compute safe grid intersections that won't form any new concyclic group of 4
export function calculateSafeCells(stones: Point[], N: number): Point[] {
  const circles = new Set<string>();
  const n = stones.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const s1 = stones[i];
        const s2 = stones[j];
        const s3 = stones[k];
        
        const x1 = s1.x, y1 = s1.y, z1 = x1*x1 + y1*y1;
        const x2 = s2.x, y2 = s2.y, z2 = x2*x2 + y2*y2;
        const x3 = s3.x, y3 = s3.y, z3 = x3*x3 + y3*y3;
        
        let A = x1*(y2 - y3) - y1*(x2 - x3) + (x2*y3 - y2*x3);
        let B = y1*(z2 - z3) - z1*(y2 - y3) + (y2*z3 - z2*y3);
        let C = x1*(z2 - z3) - z1*(x2 - x3) + (x2*z3 - z2*x3);
        let D = x1*(y2*z3 - z2*y3) - y1*(x2*z3 - z2*x3) + z1*(x2*y3 - y2*x3);
        
        C = -C;
        D = -D;
        
        if (A === 0 && B === 0 && C === 0) continue;
        
        let g = gcd4(A, B, C, D);
        if (g !== 0) {
          A /= g; B /= g; C /= g; D /= g;
        }
        if (A < 0 || (A === 0 && B < 0) || (A === 0 && B === 0 && C < 0)) {
          A = -A; B = -B; C = -C; D = -D;
        }
        circles.add(`${A}_${B}_${C}_${D}`);
      }
    }
  }
  
  const dangerous = new Uint8Array(N * N);
  for (const stone of stones) {
    dangerous[stone.y * N + stone.x] = 1;
  }
  
  for (const circleStr of circles) {
    const parts = circleStr.split('_');
    const A = parseInt(parts[0], 10);
    const B = parseInt(parts[1], 10);
    const C = parseInt(parts[2], 10);
    const D = parseInt(parts[3], 10);
    
    if (A === 0 && C === 0) {
      if (B !== 0 && (-D) % B === 0) {
         const x = (-D) / B;
         if (x >= 0 && x < N) {
           for (let y = 0; y < N; y++) dangerous[y * N + x] = 1;
         }
      }
      continue;
    }
    
    for (let x = 0; x < N; x++) {
      const E = A * x * x + B * x + D;
      if (A === 0) {
        if (C !== 0 && (-E) % C === 0) {
          const y = (-E) / C;
          if (y >= 0 && y < N) dangerous[y * N + x] = 1;
        }
      } else {
        const delta = C * C - 4 * A * E;
        if (delta >= 0) {
          const s = Math.round(Math.sqrt(delta));
          if (s * s === delta) {
            const y1 = -C + s;
            if (y1 % (2 * A) === 0) {
              const y = y1 / (2 * A);
              if (y >= 0 && y < N) dangerous[y * N + x] = 1;
            }
            const y2 = -C - s;
            if (y2 % (2 * A) === 0) {
              const y = y2 / (2 * A);
              if (y >= 0 && y < N) dangerous[y * N + x] = 1;
            }
          }
        }
      }
    }
  }
  
  const safeCells: Point[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (dangerous[r * N + c] === 0) {
        safeCells.push({ x: c, y: r });
      }
    }
  }
  return safeCells;
}
