import { defineConfig } from 'vite-plus';
const mod = process.env.ORCA_MOD;          // panel-gap | agents
const mode = process.env.ORCA_MODE;        // U | M
export default defineConfig({
  pack: {
    entry: { main: `src/features/${mod}/main.js` },
    format: ['esm'],
    platform: 'neutral',
    outDir: `out/${mod}`,
    clean: true,
    dts: false,
    minify: mode === 'M',
    sourcemap: true,
    deps: { neverBundle: ['herdr', 'gpui-kit', 'gpui-base'] },
    fixedExtension: false,
  },
});
