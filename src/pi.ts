import { registerForkInHerdr, piSpec, type ExtensionApiLike } from "./index";

/** pi entry: registers /fork-in-herdr for the pi host (pi manifests: pi.extensions). */
export default function forkInHerdrPi(pi: ExtensionApiLike): void {
  registerForkInHerdr(pi, piSpec());
}
