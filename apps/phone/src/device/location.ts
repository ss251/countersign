/** The phone's own position, read once per paid job, never watched. */

import type { Fix } from "../runner/skills.ts";

export function locationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/** The browser's remembered answer, where it will say. Safari before 16 cannot. */
export async function locationPermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

export class LocationError extends Error {
  override name = "LocationError";
}

/** A fresh fix: no cached position, high accuracy, given up after `timeoutMs` or on abort. */
export function readFix(signal?: AbortSignal, timeoutMs = 15_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!locationSupported()) {
      reject(new LocationError("This browser has no location."));
      return;
    }
    if (signal?.aborted) {
      reject(new LocationError("The hub stopped waiting."));
      return;
    }
    const onAbort = (): void => reject(new LocationError("The hub stopped waiting."));
    signal?.addEventListener("abort", onAbort, { once: true });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(new LocationError(sentenceFor(error)));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}

function sentenceFor(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "Location is blocked for this page.";
  if (error.code === error.TIMEOUT) return "This phone did not find its position in time.";
  return "This phone could not find its position.";
}
