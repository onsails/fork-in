import { registerForkInHerdr, ompSpec, type ExtensionApiLike } from "./index";

/** omp entry: registers /fork-in-herdr from the omp.extensions manifest. */
export default function forkInHerdrOmp(api: ExtensionApiLike): void {
  registerForkInHerdr(api, ompSpec());
}
