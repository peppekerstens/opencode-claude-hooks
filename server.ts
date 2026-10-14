/**
 * OpenCode V2 entry point for a local plugin directory.
 *
 * OpenCode V2 loads `server` (or `index`) from a configured plugin
 * directory. Package installs use the `./server` export instead.
 */
export { default } from "./src/v2/index";
