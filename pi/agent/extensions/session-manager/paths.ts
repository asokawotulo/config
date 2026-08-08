import { resolve } from "node:path";

export function isSameSessionPath(
  left: string | undefined,
  right: string,
): boolean {
  return left !== undefined && resolve(left) === resolve(right);
}
