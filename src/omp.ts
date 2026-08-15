import { HerdrClient } from "./herdr-client";
import { forkLabel } from "./fork-label";
import { createForkCopy, type ForkCopy } from "./fork-copy";
import { registerForkInHerdr, ompSpec, type ExtensionApiLike } from "./index";

/** omp entry: registers /fork-in-herdr for the omp host (pi manifests: omp.extensions). */
export default function forkInHerdrOmp(pi: ExtensionApiLike): void {
  registerForkInHerdr(pi, ompSpec());
}
