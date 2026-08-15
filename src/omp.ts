import { registerCommands, ompSpec, type ExtensionApiLike } from "./index";

/** omp entry: registers /fork-in-herdr and /fork-in-tmux (omp.extensions). */
export default function forkInOmp(api: ExtensionApiLike): void {
  registerCommands(api, ompSpec());
}
