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
