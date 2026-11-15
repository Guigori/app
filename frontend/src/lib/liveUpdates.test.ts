import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/queryClient";
import { onRevision } from "@/lib/liveUpdates";

afterEach(() => vi.restoreAllMocks());

describe("live updates", () => {
  it("the first revision only records where we are", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    expect(onRevision(null, 41)).toBe(41);
    expect(spy).not.toHaveBeenCalled();
  });
  it("a new revision refreshes what is cached", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    expect(onRevision(41, 42)).toBe(42);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("the same revision again does nothing", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    onRevision(42, 42);
    expect(spy).not.toHaveBeenCalled();
  });
});
