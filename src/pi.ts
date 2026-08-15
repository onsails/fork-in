import { registerCommands, piSpec, type ExtensionApiLike } from "./index";

/** pi entry: registers /fork-in-herdr and /fork-in-tmux (pi.extensions). */
export default function forkInPi(api: ExtensionApiLike): void {
  registerCommands(api, piSpec());
}
