import { registerForkInHerdr, piSpec, type ExtensionApiLike } from "./index";

/** pi entry: registers /fork-in-herdr for the pi host (pi manifests: pi.extensions). */
export default function forkInHerdrPi(api: ExtensionApiLike): void {
  registerForkInHerdr(api, piSpec());
}
